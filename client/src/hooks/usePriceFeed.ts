import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
  source: "coinbase" | "metaapi";
  volume24h?: number;
  change24h?: number;
}

interface UsePriceFeedOptions {
  symbols: string[];
  enabled?: boolean;
}

interface UsePriceFeedReturn {
  prices: Map<string, PriceUpdate>;
  isConnected: boolean;
  error: string | null;
  subscribe: (symbols: string[]) => void;
  unsubscribe: (symbols: string[]) => void;
}

export function usePriceFeed(options: UsePriceFeedOptions): UsePriceFeedReturn {
  const { symbols, enabled = true } = options;
  
  const [prices, setPrices] = useState<Map<string, PriceUpdate>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const socketRef = useRef<Socket | null>(null);
  const subscribedSymbolsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    console.log("[PriceFeed] Initializing WebSocket connection...");

    const socket = io({
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[PriceFeed] Connected to WebSocket server");
      setIsConnected(true);
      setError(null);

      if (subscribedSymbolsRef.current.size > 0) {
        const symbolsArray = Array.from(subscribedSymbolsRef.current);
        socket.emit("subscribe", symbolsArray);
      }
    });

    socket.on("disconnect", () => {
      console.log("[PriceFeed] Disconnected from WebSocket server");
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.error("[PriceFeed] Connection error:", err);
      setError(`Connection error: ${err.message}`);
    });

    socket.on("error", (err) => {
      console.error("[PriceFeed] Socket error:", err);
      setError(err.message || "Unknown error");
    });

    socket.on("price", (priceUpdate: PriceUpdate) => {
      setPrices((prev) => {
        const next = new Map(prev);
        next.set(priceUpdate.symbol, priceUpdate);
        return next;
      });
    });

    return () => {
      console.log("[PriceFeed] Cleaning up WebSocket connection");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);

  const subscribe = useCallback((symbolsToSubscribe: string[]) => {
    if (!socketRef.current || !socketRef.current.connected) {
      console.warn("[PriceFeed] Cannot subscribe: socket not connected");
      return;
    }

    console.log("[PriceFeed] Subscribing to:", symbolsToSubscribe);
    symbolsToSubscribe.forEach((symbol) => subscribedSymbolsRef.current.add(symbol));
    socketRef.current.emit("subscribe", symbolsToSubscribe);
  }, []);

  const unsubscribe = useCallback((symbolsToUnsubscribe: string[]) => {
    if (!socketRef.current || !socketRef.current.connected) {
      console.warn("[PriceFeed] Cannot unsubscribe: socket not connected");
      return;
    }

    console.log("[PriceFeed] Unsubscribing from:", symbolsToUnsubscribe);
    symbolsToUnsubscribe.forEach((symbol) => subscribedSymbolsRef.current.delete(symbol));
    socketRef.current.emit("unsubscribe", symbolsToUnsubscribe);
  }, []);

  useEffect(() => {
    if (!enabled || symbols.length === 0 || !socketRef.current) return;

    if (socketRef.current.connected) {
      subscribe(symbols);
    } else {
      const handleConnect = () => {
        subscribe(symbols);
      };
      socketRef.current.on("connect", handleConnect);
      return () => {
        socketRef.current?.off("connect", handleConnect);
      };
    }

    return () => {
      if (socketRef.current && symbols.length > 0) {
        unsubscribe(symbols);
      }
    };
  }, [enabled, symbols, subscribe, unsubscribe]);

  return {
    prices,
    isConnected,
    error,
    subscribe,
    unsubscribe,
  };
}

export function useSinglePrice(symbol: string, enabled = true) {
  const { prices, isConnected, error } = usePriceFeed({
    symbols: [symbol],
    enabled,
  });

  return {
    price: prices.get(symbol),
    isConnected,
    error,
  };
}
