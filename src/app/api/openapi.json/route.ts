import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { protocol, host } = new URL(request.url);
  const hostUrl = `${protocol}//${host}`;

  const openApiSpec: Record<string, any> = {
    openapi: "3.1.0",
    info: {
      title: "ZeroClick A2A Commerce Gateway",
      description: "Machine-readable API specification for autonomous AI Buyer Agents to browse, negotiate, and execute zero-click ecommerce checkouts.",
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
          summary: "Retrieve Product Catalog & Active Growth Manifest",
          description: "Returns authoritative drops from Postgres, live inventory stock, sizes, colors, and the Merchant Growth Capability Manifest.",
          operationId: "getCatalog",
          responses: {
            "200": {
              description: "Structured product list and growth manifest for AI parsing.",
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
                            description: { type: "string", description: "Authoritative merchant product description" },
                            price_inr: { type: "number", description: "Price in INR" },
                            price_paise: { type: "integer", description: "Price in paise" },
                            compare_price_inr: { type: ["number", "null"] },
                            category: { type: "string" },
                            stock: { type: "integer", description: "Available stock units" },
                            sizes: { type: "array", items: { type: "string" } },
                            colors: { type: "array", items: { type: "string" } },
                            image_url: { type: "string", format: "uri", description: "Absolute public HTTPS URL to authoritative product asset" },
                            images: { type: "array", items: { type: "string", format: "uri" }, description: "Array of absolute public HTTPS asset URLs" },
                            image: { type: "string", description: "Legacy image URL/path for backward compatibility" },
                            ai_summary: { type: "string" },
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
                      },
                      policy_version: { type: "string", description: "Active merchant policy version snapshot" },
                      active_growth_rules: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            type: { type: "string" },
                            description: { type: "string" },
                            discount_percent: { type: "number" },
                            discount_amount_paise: { type: "integer" },
                            buy_quantity: { type: "integer" },
                            free_quantity: { type: "integer" },
                            quantity_tiers: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  min_quantity: { type: "integer" },
                                  discount_percent: { type: "number" }
                                }
                              }
                            },
                            product_ids: { type: "array", items: { type: "string" } },
                            trigger_product_ids: { type: "array", items: { type: "string" } },
                            reward_product_ids: { type: "array", items: { type: "string" } },
                            buyer_eligibility: { type: "string" },
                            min_cart_value_paise: { type: "integer" },
                            reorder_interval_days: { type: "integer" },
                            max_discount_paise: { type: "integer" },
                            margin_floor_percent: { type: "number" },
                            max_redemptions_per_order: { type: "integer" },
                            stackable: { type: "boolean" },
                            active: { type: "boolean" },
                            recommendation_reason: { type: "string" }
                          }
                        }
                      },
                      active_bundles: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            discount_percent: { type: "number" },
                            active: { type: "boolean" },
                            product_ids: { type: "array", items: { type: "string" } },
                            product_a_id: { type: "string" },
                            product_b_id: { type: "string" },
                            recommendation_reason: { type: "string" }
                          }
                        }
                      },
                      promotions: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            type: { type: "string" },
                            recommendation_reason: { type: "string" }
                          }
                        }
                      },
                      merchant_capability_manifest: {
                        type: "object",
                        properties: {
                          policy_version: { type: "string" },
                          max_autonomous_cap_paise: { type: "integer" },
                          quote_ttl_seconds: { type: "integer" },
                          mandate_required: { type: "boolean" },
                          active_bundles: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                id: { type: "string" },
                                name: { type: "string" },
                                discount_percent: { type: "number" },
                                active: { type: "boolean" },
                                product_ids: { type: "array", items: { type: "string" } }
                              }
                            }
                          },
                          active_growth_rules: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                id: { type: "string" },
                                name: { type: "string" },
                                type: { type: "string" },
                                description: { type: "string" },
                                discount_percent: { type: "number" },
                                discount_amount_paise: { type: "integer" },
                                buy_quantity: { type: "integer" },
                                free_quantity: { type: "integer" },
                                product_ids: { type: "array", items: { type: "string" } },
                                recommendation_reason: { type: "string" },
                                stackable: { type: "boolean" },
                                active: { type: "boolean" }
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
        }
      },
      "/api/agent/quote": {
        post: {
          summary: "Submit Programmatic Bid & Request Signed Quote",
          description: "Submits an autonomous bid price for a product. Verifies merchant policy boundaries and returns an HMAC-SHA256 signed quote token with TTL expiry.",
          operationId: "submitBid",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["product_id", "size"],
                  properties: {
                    product_id: { type: "string" },
                    bid_price_paise: { type: "integer" },
                    size: { type: "string" },
                    quantity: { type: "integer", default: 1 },
                    cart_id: { type: "string", default: "default_cart" },
                    session_id: { type: "string" },
                    buyer_context: {
                      type: "object",
                      properties: {
                        is_new_buyer: { type: "boolean" },
                        completed_orders_count: { type: "integer" },
                        has_failed_payment: { type: "boolean" },
                        days_since_last_order: { type: "integer" }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Bid accepted. Returns signed HMAC quote token for the complete cart.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      quote_id: { type: "string", description: "Cryptographically signed HMAC-SHA256 quote token" },
                      policy_version: { type: "string" },
                      product_id: { type: "string" },
                      quantity: { type: "integer" },
                      unit_price_paise: { type: "integer", description: "Authoritative price of single unit" },
                      subtotal_paise: { type: "integer", description: "Authoritative subtotal (unit_price * quantity)" },
                      discount_paise: { type: "integer", description: "Total discount applied" },
                      agreed_price_paise: { type: "integer", description: "Final cart total for the complete order" },
                      currency: { type: "string" },
                      expires_at: { type: "string" },
                      applied_rules: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            rule_id: { type: "string" },
                            rule_name: { type: "string" },
                            rule_type: { type: "string" },
                            discount_paise: { type: "integer" },
                            reason: { type: "string" }
                          }
                        }
                      },
                      excluded_rules: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            rule_id: { type: "string" },
                            rule_name: { type: "string" },
                            rule_type: { type: "string" },
                            potential_discount_paise: { type: "integer" },
                            reason: { type: "string" }
                          }
                        }
                      },
                      paid_quantity: { type: "integer" },
                      free_quantity: { type: "integer" },
                      lines: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            product_id: { type: "string" },
                            name: { type: "string" },
                            unit_price_paise: { type: "integer" },
                            quantity: { type: "integer" },
                            paid_quantity: { type: "integer" },
                            free_quantity: { type: "integer" },
                            line_subtotal_paise: { type: "integer" },
                            line_discount_paise: { type: "integer" },
                            line_total_paise: { type: "integer" },
                            size: { type: "string" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            "422": {
              description: "Bid rejected (below minimum margin floor or product out of stock)."
            }
          }
        }
      },
      "/api/razorpay/order": {
        post: {
          summary: "Autonomous Zero-Click Checkout",
          description: "Executes final order creation evaluating 8 server-side security gates, atomic inventory allocation, and Razorpay payment rails.",
          operationId: "executeCheckout",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "quantity"],
                        properties: {
                          id: { type: "string" },
                          quantity: { type: "integer" },
                          size: { type: "string" },
                          color: { type: "string" }
                        }
                      }
                    },
                    expected_total_paise: { type: "integer", description: "Authoritative final cart total in paise after all growth rules, quantities, and discounts" },
                    quote_id: { type: "string", description: "Cryptographically signed HMAC quote token (required if order was quoted/negotiated)" },
                    cart_id: { type: "string", description: "Unique cart session identifier matching the quote token scope" },
                    mandate_authorized: { type: "boolean" },
                    buyer_context: {
                      type: "object",
                      properties: {
                        is_new_buyer: { type: "boolean" },
                        completed_orders_count: { type: "integer" },
                        has_failed_payment: { type: "boolean" }
                      }
                    },
                    session_id: { type: "string" },
                    idempotency_key: { type: "string" }
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
                      currency: { type: "string" },
                      receipt: { type: "string" },
                      payment_link_url: { type: "string" }
                    }
                  }
                }
              }
            },
            "422": {
              description: "Validation failure (budget exceeded, stock out, or price mismatch).",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      error: { type: "string" },
                      details: { type: "string" },
                      alternatives: {
                        type: "array",
                        items: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/razorpay/order/status": {
        get: {
          summary: "Verify Order Status",
          description: "Returns the real-time payment status of the specified order ID.",
          operationId: "getOrderStatus",
          parameters: [
            {
              name: "order_id",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "The unique order ID generated during checkout."
            }
          ],
          responses: {
            "200": {
              description: "Status query successful.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      order_id: { type: "string" },
                      payment_status: { type: "string" },
                      total_amount_paise: { type: "integer" }
                    }
                  }
                }
              }
            },
            "404": {
              description: "Order not found."
            }
          }
        }
      },
      "/api/agent/ledger": {
        get: {
          summary: "View Trust Ledger Audit Logs",
          description: "Returns the complete history of autonomous commerce transactions, gate evaluations, and security decision traces.",
          operationId: "getTrustLedger",
          responses: {
            "200": {
              description: "Durable audit trail logs returned successfully.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      events: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            timestamp: { type: "string" },
                            actor: { type: "string" },
                            action: { type: "string" },
                            session_id: { type: ["string", "null"] },
                            cart_id: { type: ["string", "null"] },
                            quote_id: { type: ["string", "null"] },
                            order_id: { type: ["string", "null"] },
                            policy_version: { type: ["string", "null"] },
                            amount_before: { type: ["number", "null"] },
                            amount_after: { type: ["number", "null"] },
                            policy_result: { type: "string" },
                            reason_code: { type: ["string", "null"] },
                            outcome: { type: "string" }
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
      "/api/merchant/config": {
        get: {
          summary: "Retrieve Merchant Configurations & Policy Versions",
          description: "Returns the current global agent policies, growth rules, and product negotiation overrides.",
          operationId: "getMerchantConfig",
          responses: {
            "200": {
              description: "Configuration object returned successfully."
            }
          }
        },
        post: {
          summary: "Save Merchant Configurations & Create Immutable Snapshot",
          description: "Updates global agent boundaries, publishes growth rules, and records a permanent version snapshot.",
          operationId: "saveMerchantConfig",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    config: { type: "object" },
                    products: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          price_paise: { type: "integer" },
                          stock: { type: "integer" },
                          active: { type: "boolean" }
                        }
                      }
                    },
                    change_summary: { type: "string" },
                    rollback_version: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Settings and database products updated successfully."
            },
            "422": {
              description: "Validation error."
            }
          }
        }
      },
      "/api/merchant/policy/{version}/performance": {
        get: {
          summary: "Retrieve Policy Version Performance Analytics",
          description: "Returns immutable configuration and derived business performance metrics (revenue, orders, AOV, buyer savings, quotes) for a specific policy snapshot.",
          operationId: "getPolicyVersionPerformance",
          parameters: [
            {
              name: "version",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The policy version tag (e.g., v1, v2)."
            }
          ],
          responses: {
            "200": {
              description: "Performance metrics for the requested policy version returned successfully."
            },
            "404": {
              description: "Policy version not found."
            }
          }
        }
      },
      "/api/protocol/adapter": {
        get: {
          summary: "Protocol Compatibility Adapter (GET)",
          description: "Returns protocol-shaped catalog, manifest, or service discovery envelopes for ACP, AP2, or x402 agents.",
          operationId: "protocolAdapterGet",
          parameters: [
            {
              name: "protocol",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["acp-shaped", "ap2-shaped", "x402-shaped"] }
            },
            {
              name: "action",
              in: "query",
              schema: { type: "string" }
            },
            {
              name: "endpoint",
              in: "query",
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Protocol-wrapped catalog or manifest response."
            }
          }
        },
        post: {
          summary: "Protocol Compatibility Adapter (POST)",
          description: "Unified envelope adapter accepting acp-shaped, ap2-shaped, and x402-shaped requests and executing on the authoritative ZeroClick safety engine.",
          operationId: "protocolAdapterPost",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["protocol", "action"],
                  properties: {
                    protocol: { type: "string", enum: ["acp-shaped", "ap2-shaped", "x402-shaped"] },
                    action: { type: "string", enum: ["catalog", "quote", "checkout"] },
                    session_id: { type: "string" },
                    cart_id: { type: "string" },
                    payload: { type: "object" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Action executed and wrapped in protocol envelope."
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
