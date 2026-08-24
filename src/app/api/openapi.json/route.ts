import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { protocol, host } = new URL(request.url);
  const hostUrl = `${protocol}//${host}`;

  const openApiSpec = {
    openapi: "3.0.0",
    info: {
      title: "ZeroClick A2A Commerce Gateway",
      description: "Machine-readable API spec for autonomous AI Buyer Agents to browse, negotiate, and purchase streetwear drops.",
      version: "1.0.0"
    },
    servers: [
      {
        url: hostUrl,
        description: "Active Commerce Server Instance"
      }
    ],
    paths: {
      "/api/agent/catalog": {
        get: {
          summary: "Retrieve Product Catalog",
          description: "Returns active drops, inventory stock, sizes, and promotional bundle rules.",
          operationId: "getCatalog",
          responses: {
            "200": {
              description: "Structured product list for AI parsing.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      products: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            slug: { type: "string" },
                            price_paise: { type: "integer" },
                            category: { type: "string" },
                            stock: { type: "integer" },
                            sizes: { type: "array", items: { type: "string" } },
                            colorways: { type: "array", items: { type: "string" } },
                            description: { type: "string" },
                            negotiable: { type: "boolean" },
                            negotiation_policy: {
                              type: "object",
                              properties: {
                                max_allowed_discount_pct: { type: "integer" },
                                quote_endpoint: { type: "string" }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
      },
      "/api/agent/quote": {
        post: {
          summary: "Submit Programmatic Bid",
          description: "Submits an autonomous bid price for a specific product. Checks merchant policies and returns a signed quote_id if accepted.",
          operationId: "submitBid",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["product_id", "bid_price_paise", "size"],
                  properties: {
                    product_id: { type: "string" },
                    bid_price_paise: { type: "integer" },
                    size: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Bid accepted. Returns signed quote token.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      quote_id: { type: "string" },
                      agreed_price_paise: { type: "integer" }
                    }
                  }
                }
              }
            },
            "422": {
              description: "Bid rejected (too low or out of stock)."
            }
          }
        }
      },
      "/api/agent/chat": {
        post: {
          summary: "Negotiate Cart Quote",
          description: "Submits dialogue messages to merchant AI clerk to negotiate colorways, sizes, and bundle discounts.",
          operationId: "negotiateOrder",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["messages"],
                  properties: {
                    messages: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          role: { type: "string", enum: ["user", "assistant", "system"] },
                          content: { type: "string" }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "AI Clerk response and structured cart proposal.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      reply: { type: "string" },
                      cart: {
                        type: "object",
                        properties: {
                          items: { type: "array" },
                          total_price_paise: { type: "integer" }
                        }
                      },
                      logs: { type: "array", items: { type: "string" } }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/razorpay/order": {
        post: {
          summary: "Secure Checkout Payment",
          description: "Executes final transaction checking budget caps, price integrity, and atomic stock reservation.",
          operationId: "executeCheckout",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "budget_cap_paise", "expected_total_paise"],
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          quantity: { type: "integer" }
                        }
                      }
                    },
                    budget_cap_paise: { type: "integer" },
                    expected_total_paise: { type: "integer" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Successful Razorpay Order creation.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      order_id: { type: "string" },
                      amount_paise: { type: "integer" },
                      receipt: { type: "string" }
                    }
                  }
                }
              }
            },
            "422": {
              description: "Validation failure (budget exceeded, stock out, or price tampered).",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      error: { type: "string" },
                      details: { type: "string" },
                      alternatives: { type: "array" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  return NextResponse.json(openApiSpec, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}
