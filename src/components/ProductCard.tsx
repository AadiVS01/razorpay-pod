"use client";

import React, { useState } from "react";
import { Product, AgentProductItem } from "@/types/catalog";
import { transformProductForAgent, getAllProductImages } from "@/lib/catalog-service";
import { formatCurrency } from "@/lib/utils";
import { Tag, Sparkles, Box, Check, Copy } from "lucide-react";

interface ProductCardProps {
  product: Product;
  onInspectJson?: (agentProduct: AgentProductItem) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onInspectJson,
}) => {
  const agentProduct = transformProductForAgent(product);
  const colors = product.colors || (product.color_images ? Object.keys(product.color_images) : []);
  const [selectedColor, setSelectedColor] = useState<string | null>(
    colors.length > 0 ? colors[0] : null
  );
  const [selectedSize, setSelectedSize] = useState<string>(
    product.sizes && product.sizes.length > 0 ? product.sizes[0] : "OS"
  );
  const [copiedSku, setCopiedSku] = useState(false);

  // Get active display images based on selected color
  let displayImages: string[] = [];
  if (selectedColor && product.color_images && product.color_images[selectedColor]?.length > 0) {
    displayImages = product.color_images[selectedColor];
  } else {
    displayImages = getAllProductImages(product);
  }

  const isOutOfStock = product.stock <= 0;
  const isSale = product.compare_price && product.compare_price > product.price;

  const handleCopySku = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(agentProduct.sku);
    setCopiedSku(true);
    setTimeout(() => setCopiedSku(false), 2000);
  };

  return (
    <div className="flex flex-col group w-full text-left">
      
      {/* Product Image Box matching pod-store */}
      <div className="w-full overflow-hidden bg-muted relative aspect-[3/4] border border-border">
        
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-foreground/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10 pointer-events-none" />

        {/* Primary Image & Alternate on hover */}
        {displayImages && displayImages.length > 0 ? (
          <>
            <img
              src={displayImages[0]}
              alt={product.name}
              className={`object-cover w-full h-full transform transition-all duration-700 ease-out group-hover:scale-105 ${
                displayImages.length > 1 ? "group-hover:opacity-0 absolute inset-0" : ""
              }`}
            />
            {displayImages.length > 1 && (
              <img
                src={displayImages[1]}
                alt={`${product.name} alternate view`}
                className="object-cover w-full h-full transform transition-all duration-700 ease-out opacity-0 group-hover:opacity-100 group-hover:scale-105"
              />
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center font-mono text-xs text-muted-foreground tracking-widest uppercase font-bold">
            No image available
          </div>
        )}

        {/* Sold Out Overlay */}
        {isOutOfStock && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-[1px] flex items-center justify-center z-20">
            <span className="border-2 border-foreground px-5 py-2 text-sm uppercase font-black tracking-widest font-mono">
              Sold Out
            </span>
          </div>
        )}

        {/* Sale Badge */}
        {!isOutOfStock && isSale && (
          <div className="absolute top-3 left-3 bg-foreground text-background px-3 py-1 text-xs font-black tracking-widest uppercase font-mono z-20">
            Sale {agentProduct.discount_pct}% OFF
          </div>
        )}

        {/* Stock Badge */}
        <div className="absolute top-3 right-3 z-20">
          <span className="bg-background/90 text-foreground px-2.5 py-1 text-[11px] font-mono font-bold uppercase tracking-wider border border-border">
            {product.stock} IN STOCK
          </span>
        </div>

        {/* Machine SKU Bar on bottom of image */}
        <div className="absolute bottom-0 inset-x-0 bg-foreground/90 text-background px-3 py-1.5 flex items-center justify-between text-xs font-mono z-20">
          <div className="flex items-center space-x-1.5">
            <Tag className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-bold tracking-wider">{agentProduct.sku}</span>
          </div>
          <button
            onClick={handleCopySku}
            title="Copy SKU for AI Agent"
            className="hover:text-amber-400 transition-colors"
          >
            {copiedSku ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Product Details matching pod-store */}
      <div className="flex flex-col gap-2 mt-3 w-full">
        
        {/* Title & Price Header */}
        <div className="flex justify-between items-start w-full">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-black text-foreground group-hover:text-muted-foreground text-base sm:text-lg uppercase tracking-tight group-hover:underline decoration-2 underline-offset-4 leading-snug">
              {product.name}
            </h3>
            <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest font-bold">
              {product.category || "Apparel"}
            </span>
          </div>

          <div className="flex flex-col items-end shrink-0 pl-2">
            <span className="font-mono text-base sm:text-lg font-black text-foreground">
              {formatCurrency(product.price)}
            </span>
            {product.compare_price && product.compare_price > product.price && (
              <span className="text-xs text-muted-foreground line-through font-mono">
                {formatCurrency(product.compare_price)}
              </span>
            )}
          </div>
        </div>

        {/* Color Options */}
        {colors.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground mr-1">
              Color:
            </span>
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setSelectedColor(color)}
                className={`px-2 py-0.5 text-[11px] font-mono font-bold uppercase border transition-colors ${
                  selectedColor === color
                    ? "bg-foreground text-background border-foreground"
                    : "bg-muted/60 text-foreground border-border hover:bg-muted"
                }`}
              >
                {color}
              </button>
            ))}
          </div>
        )}

        {/* Available Sizes */}
        {product.sizes && product.sizes.length > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground mr-1">
              Sizes:
            </span>
            {product.sizes.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setSelectedSize(size)}
                className={`px-2 py-0.5 text-[11px] font-mono font-bold uppercase border transition-colors ${
                  selectedSize === size
                    ? "bg-foreground text-background border-foreground"
                    : "bg-muted/60 text-foreground border-border hover:bg-muted"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        )}

        {/* Cross-Sell Bundle Offer Callout */}
        {agentProduct.bundle_offers && agentProduct.bundle_offers.length > 0 && (
          <div className="mt-2 p-2 bg-muted/50 border border-border flex items-start space-x-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] font-mono text-muted-foreground leading-tight">
              <span className="font-bold text-foreground uppercase">A2A Bundle:</span>{" "}
              {agentProduct.bundle_offers[0].description}
            </p>
          </div>
        )}

        {/* Inspect Schema Button */}
        {onInspectJson && (
          <button
            onClick={() => onInspectJson(agentProduct)}
            className="mt-2 w-full py-1.5 border border-foreground text-xs font-mono font-bold uppercase tracking-wider hover:bg-foreground hover:text-background transition-colors flex items-center justify-center space-x-1.5"
          >
            <Box className="w-3.5 h-3.5" />
            <span>Inspect A2A Schema</span>
          </button>
        )}

      </div>
    </div>
  );
};
