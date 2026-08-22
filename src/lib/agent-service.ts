import { Product, AgentProductItem } from "@/types/catalog";
import { getStoreProducts, transformProductForAgent } from "./catalog-service";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CartItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  price_paise: number;
  size: string;
  color: string;
}

export interface CartQuote {
  items: CartItem[];
  total_price_paise: number;
}

export interface AgentChatResponse {
  reply: string;
  cart?: CartQuote;
  logs: string[];
}

/**
 * Clean rules-based offline backup chat assistant for ZeroClick
 */
async function fallbackAgentChat(messages: ChatMessage[], products: Product[]): Promise<AgentChatResponse> {
  const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content.toLowerCase() || "";
  const logs: string[] = ["⚡ Groq Key missing/placeholder. Initializing rule-based fallback agent."];
  
  let reply = "";
  let cart: CartQuote | undefined = undefined;

  const activeTee = products.find(p => p.slug === "argentina-sun-of-may-tee");
  const transformedTee = activeTee ? transformProductForAgent(activeTee) : null;

  logs.push(`[CATALOG] Found ${products.length} active products in catalog.`);

  if (lastUserMessage.includes("buy") || lastUserMessage.includes("order") || lastUserMessage.includes("add")) {
    logs.push("[INTENT] Detected purchase/cart request.");
    if (activeTee) {
      // Formulate a structured cart quote
      const pricePaise = activeTee.price;
      cart = {
        items: [
          {
            id: activeTee.id,
            sku: transformedTee?.sku || "SKU-T-S-ARGE",
            name: activeTee.name,
            quantity: 1,
            price_paise: pricePaise,
            size: "L",
            color: "White",
          }
        ],
        total_price_paise: pricePaise,
      };
      
      logs.push(`[CART] Built machine cart. Total: ₹${Math.round(pricePaise / 100)}`);
      
      reply = `Adding the **Argentina Sun Of May Tee** (Size: L, Color: White) to your cart. 

Here is your structured agent checkout quote:
\`\`\`json
{
  "cart": {
    "items": [
      {
        "id": "${activeTee.id}",
        "sku": "${transformedTee?.sku || "SKU-T-S-ARGE"}",
        "name": "${activeTee.name}",
        "quantity": 1,
        "price_paise": ${pricePaise},
        "size": "L",
        "color": "White"
      }
    ],
    "total_price_paise": ${pricePaise}
  }
}
\`\`\`

Ready to checkout? We can verify payment bounds next!`;
    } else {
      reply = "Sorry, we don't have any items in stock right now.";
    }
  } else if (lastUserMessage.includes("bundle") || lastUserMessage.includes("pants") || lastUserMessage.includes("upsell") || lastUserMessage.includes("deal")) {
    logs.push("[INTENT] Detected bundle query.");
    reply = `Yes! We offer a special **A2A bundle deal** for the **Argentina Sun Of May Tee**:
- Add matching **Sweatpants** to your order and receive a **15% combo discount**!

Would you like me to create a bundled quote for you?`;
  } else if (lastUserMessage.includes("size") || lastUserMessage.includes("color") || lastUserMessage.includes("variant")) {
    logs.push("[INTENT] Detected variant query.");
    if (activeTee) {
      reply = `The **Argentina Sun Of May Tee** is available in:
- **Sizes:** ${activeTee.sizes.join(", ")}
- **Colors:** White, Off-White

Which variants should I add to the cart?`;
    } else {
      reply = "Variants are currently unavailable.";
    }
  } else {
    logs.push("[INTENT] Parsed general greeting / product recommendation request.");
    if (activeTee) {
      reply = `Yo! Welcome to **ZeroClick**. I'm your automated A2A Sales Assistant.

I recommend our featured drop:
*   **${activeTee.name}** (₹${Math.round(activeTee.price / 100)})
    *Category: ${activeTee.category}*
    *AI Summary: ${activeTee.description?.substring(0, 100)}...*

You can ask me to **"Buy this tee"**, ask about **"sizes"**, or check out the **"bundle deal"**!`;
    } else {
      reply = "Yo! Welcome to ZeroClick. The catalog is currently being loaded.";
    }
  }

  return { reply, cart, logs };
}

/**
 * Handles conversational merchant interactions via Groq Cloud API
 */
export async function getAgentChatResponse(messages: ChatMessage[]): Promise<AgentChatResponse> {
  const products = await getStoreProducts();
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  if (!apiKey || apiKey === "gsk_placeholder") {
    return fallbackAgentChat(messages, products);
  }

  const logs: string[] = ["⚡ Connecting to Groq Cloud API LPU..."];

  try {
    const formattedCatalog = products.map(p => {
      const item = transformProductForAgent(p);
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category,
        price_inr: item.price_inr,
        price_paise: item.price_paise,
        sizes: item.sizes,
        colors: item.colors,
        stock: item.stock,
        in_stock: item.in_stock,
        bundle_offers: item.bundle_offers
      };
    });

    const systemPrompt = `You are the "ZeroClick Merchant Sales Assistant", an automated street-smart sales agent for an online print-on-demand streetwear apparel drops store.
Your goal is to help customers or AI buyer agents find products, answer stock questions, negotiate A2A bundle deals, and build machine-readable order quotes.

Here is the current active product catalog:
${JSON.stringify(formattedCatalog, null, 2)}

Rules:
1. Speak in a helpful, direct, streetwear brand persona. Keep it concise.
2. If the user expresses interest in buying/ordering, choose the item, size (default to L or user selection), color (default to White or user selection), and output a structured JSON quote block at the end of your response inside a fenced code block exactly like this:
\`\`\`json
{
  "cart": {
    "items": [
      {
        "id": "product-uuid",
        "sku": "SKU-...",
        "name": "Product Name",
        "quantity": 1,
        "price_paise": 64900,
        "size": "L",
        "color": "White"
      }
    ],
    "total_price_paise": 64900
  }
}
\`\`\`
3. If they are interested in apparel, proactively cross-sell the configured A2A bundle offer (e.g. suggesting accessories for 20% discount or matching pants for 15% discount) to grow revenue.
4. Keep the JSON quote block at the very end of your response, separate from your conversation.`;

    const requestMessages = [
      { role: "system", content: systemPrompt },
      ...messages
    ];

    logs.push(`[GROQ] Sending prompt to ${model}...`);
    const start = performance.now();

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: requestMessages,
        temperature: 0.2,
        max_tokens: 800
      })
    });

    const end = performance.now();
    logs.push(`[GROQ] Completed response in ${Math.round(end - start)}ms.`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const reply = result.choices[0].message.content || "";

    // Parse JSON block out of the LLM reply
    let cart: CartQuote | undefined = undefined;
    const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed && parsed.cart) {
          cart = parsed.cart as CartQuote;
          logs.push(`[CART] Parsed A2A Cart Quote from AI response. Total: ₹${Math.round(cart.total_price_paise / 100)}`);
        }
      } catch (jsonErr) {
        logs.push(`[WARN] Failed to parse JSON code block: ${jsonErr}`);
      }
    }

    return { reply, cart, logs };

  } catch (err: any) {
    logs.push(`[ERROR] Groq API call failed: ${err.message || err}`);
    return fallbackAgentChat(messages, products);
  }
}
