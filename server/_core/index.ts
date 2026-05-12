import "dotenv/config";
import { getActiveClock } from '../_core/clock';
// Initialize log buffer FIRST — before any other imports that might log
import { initializeLogBuffer } from '../services/ServerLogBuffer';
initializeLogBuffer();

import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { getMultiWebSocketServer } from '../websocket/WebSocketServerMulti';
import { priceFeedService } from '../services/priceFeedService';
import { serveStatic, setupVite } from "./vite";
import { processManager } from './processManager';
import cors from 'cors';
import { authRouter } from './authRouter';
import { ENV } from './env';

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  
  // Trust proxy - CRITICAL for proper cookie handling behind Manus proxy
  app.set('trust proxy', 1);
  
  // Cookie parser - required for reading cookies from requests
  app.use(cookieParser());
  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // Health check endpoints (no rate limiting — monitoring must always work)
  const { healthRouter } = await import('../routes/health');
  app.use('/api', healthRouter);



  // OAuth callback under /api/oauth/callback (rate limited to prevent abuse)
  registerOAuthRoutes(app);

  // ============================================
  // RATE LIMITING (HTTP endpoints ONLY — never WebSocket/trading pipeline)
  // ============================================
  // Auth endpoints: strict limit per IP to prevent brute force.
  //
  // Phase 82 hotfix — express-rate-limit v8 throws ERR_ERL_KEY_GEN_IPV6 at
  // startup if a custom keyGenerator uses `req.ip` raw (every IPv6 address
  // is unique per-client by default, defeating per-IP buckets). The
  // exported `ipKeyGenerator` helper normalises IPv6 to /64 prefixes so a
  // single mobile carrier-NAT host can't bypass the limit. Without this,
  // the server died on startup → pm2 crash-looped (353 restarts) →
  // every browser request returned 502 → agents flashed and disappeared.
  const { createRateLimiter } = await import('../services/RateLimiter');
  const { ipKeyGenerator } = await import('express-rate-limit');
  const authLimiter = await createRateLimiter('auth', {
    keyGenerator: (req: any) => ipKeyGenerator(req.ip || req.connection?.remoteAddress || 'unknown'),
  });
  // General API limiter for tRPC and REST endpoints
  const generalLimiter = await createRateLimiter('general', {
    keyGenerator: (req: any) => {
      // Use userId from cookie if available, otherwise IPv6-safe IP key
      try {
        const token = req.cookies?.[require('@shared/const').COOKIE_NAME];
        if (token) {
          const decoded = require('jsonwebtoken').verify(token, ENV.jwtSecret) as any;
          if (decoded?.userId) return `user:${decoded.userId}`;
        }
      } catch {}
      return ipKeyGenerator(req.ip || req.connection?.remoteAddress || 'unknown');
    },
  });

  // ============================================
  // AUTHENTICATION ROUTES (Optimized, Fast)
  // ============================================
  // Use the dedicated auth router with static imports and connection pooling
  // Rate limited: 5 req/min per IP to prevent brute force attacks
  app.use('/api/auth', authLimiter, authRouter);
  
  // ============================================
  // SETTINGS ROUTES (Direct REST)
  // ============================================
  
  // Direct REST endpoint for getting auto trading status
  app.get('/api/settings/auto-trading', async (req, res) => {
    try {
      const jwt = await import('jsonwebtoken');
      const { getDb } = await import('../db');
      const { engineState } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const { COOKIE_NAME } = await import('@shared/const');
      
      const token = req.cookies?.[COOKIE_NAME];
      if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      const jwtSecret = ENV.jwtSecret;
      const decoded = jwt.default.verify(token, jwtSecret) as { userId: number };
      
      const db = await getDb();
      if (!db) {
        return res.status(500).json({ error: 'Database not available' });
      }
      
      const result = await db.select().from(engineState).where(eq(engineState.userId, decoded.userId)).limit(1);
      
      if (result.length === 0) {
        return res.json({ enabled: false });
      }
      
      const config = result[0].config as { enableAutoTrading?: boolean } | null;
      return res.json({ enabled: config?.enableAutoTrading ?? false });
    } catch (error: any) {
      console.error('[REST Auto Trading Get Error]', error);
      return res.status(500).json({ error: error.message });
    }
  });
  
  // Direct REST endpoint for updating auto trading status
  app.post('/api/settings/auto-trading', async (req, res) => {
    try {
      const jwt = await import('jsonwebtoken');
      const { getDb } = await import('../db');
      const { engineState } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const { COOKIE_NAME } = await import('@shared/const');
      
      const token = req.cookies?.[COOKIE_NAME];
      if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      const jwtSecret = ENV.jwtSecret;
      const decoded = jwt.default.verify(token, jwtSecret) as { userId: number };
      
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      
      const db = await getDb();
      if (!db) {
        return res.status(500).json({ error: 'Database not available' });
      }
      
      // Get current engine state
      const result = await db.select().from(engineState).where(eq(engineState.userId, decoded.userId)).limit(1);
      
      if (result.length === 0) {
        // Create new engine state with auto trading setting
        await db.insert(engineState).values({
          userId: decoded.userId,
          isRunning: false,
          config: { enableAutoTrading: enabled },
        });
      } else {
        // Update existing config
        const existingConfig = (result[0].config as Record<string, any>) || {};
        await db
          .update(engineState)
          .set({
            config: { ...existingConfig, enableAutoTrading: enabled },
          })
          .where(eq(engineState.userId, decoded.userId));
      }
      
      console.log(`[REST Auto Trading] User ${decoded.userId} set auto trading to ${enabled}`);
      return res.json({ success: true, enabled });
    } catch (error: any) {
      console.error('[REST Auto Trading Update Error]', error);
      return res.status(500).json({ error: error.message });
    }
  });
  
  // Position cache for faster responses - increased TTL to reduce DB load
  const positionCache = new Map<number, { positions: any[], timestamp: number }>();
  const POSITION_CACHE_TTL = 5000; // 5 second cache (increased from 2s to reduce DB contention)
  
  // Direct REST endpoint for positions with live prices
  // CRITICAL: This endpoint must be fast and non-blocking to prevent 504 timeouts
  app.get('/api/positions/live', async (req, res) => {
    const requestStart = getActiveClock().now();
    
    // Set a timeout for this request (15s - increased to handle slow DB connections)
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        console.error('[REST Positions] Request timeout after', getActiveClock().now() - requestStart, 'ms');
        res.status(504).json({ error: 'Request timeout', positions: [] });
      }
    }, 15000);
    
    try {
      const jwt = await import('jsonwebtoken');
      const { getDb } = await import('../db');
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const { COOKIE_NAME } = await import('@shared/const');
      
      const token = req.cookies?.[COOKIE_NAME];
      if (!token) {
        clearTimeout(timeout);
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      const jwtSecret = ENV.jwtSecret;
      let decoded: { userId: number };
      try {
        decoded = jwt.default.verify(token, jwtSecret) as { userId: number };
      } catch (jwtError) {
        clearTimeout(timeout);
        console.error('[REST Positions] JWT verification failed:', jwtError);
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      // Check cache first for faster response
      const cached = positionCache.get(decoded.userId);
      if (cached && getActiveClock().now() - cached.timestamp < POSITION_CACHE_TTL) {
        console.log('[REST Positions] Serving from cache for userId:', decoded.userId);
        clearTimeout(timeout);
        // Update prices from price feed service
        const positionsWithPrices = cached.positions.map((pos: any) => {
          try {
            const priceData = priceFeedService.getLatestPrice(pos.symbol);
            const entryPrice = Number(pos.entryPrice);
            const quantity = Number(pos.quantity) || 0;
            const side = pos.side;
            let unrealizedPnl = 0;
            let unrealizedPnlPercent = 0;
            const price = priceData?.price || 0;
            if (price > 0 && entryPrice > 0) {
              if (side === 'long') {
                unrealizedPnl = (price - entryPrice) * quantity;
                unrealizedPnlPercent = ((price - entryPrice) / entryPrice) * 100;
              } else {
                unrealizedPnl = (entryPrice - price) * quantity;
                unrealizedPnlPercent = ((entryPrice - price) / entryPrice) * 100;
              }
            }
            return { ...pos, currentPrice: price || null, unrealizedPnl, unrealizedPnlPercent };
          } catch (err) {
            return { ...pos, currentPrice: null, unrealizedPnl: 0, unrealizedPnlPercent: 0 };
          }
        });
        return res.json({ positions: positionsWithPrices });
      }
      
      console.log('[REST Positions] Getting database connection...');
      const dbStart = getActiveClock().now();
      const db = await getDb();
      console.log('[REST Positions] Got database in', getActiveClock().now() - dbStart, 'ms');
      if (!db) {
        clearTimeout(timeout);
        return res.status(500).json({ error: 'Database not available' });
      }
      
      // Get open positions from paperPositions table (paper trading mode)
      console.log('[REST Positions] Fetching positions for userId:', decoded.userId);
      
      // Execute query directly without Promise.race (connection pool handles timeouts)
      const queryStart = getActiveClock().now();
      const openPositions = await db
        .select()
        .from(paperPositions)
        .where(and(eq(paperPositions.userId, decoded.userId), eq(paperPositions.status, 'open')));
      console.log('[REST Positions] Query completed in', getActiveClock().now() - queryStart, 'ms');
      
      // Store in cache
      positionCache.set(decoded.userId, { positions: openPositions, timestamp: getActiveClock().now() });
      
      console.log('[REST Positions] Found', openPositions.length, 'open positions');
      
      // Get live prices from price feed service (synchronous, no await needed)
      const positionsWithPrices = openPositions.map((pos) => {
        try {
          const priceData = priceFeedService.getLatestPrice(pos.symbol);
          const entryPrice = Number(pos.entryPrice);
          const quantity = Number(pos.quantity) || 0;
          const side = pos.side;
          
          let unrealizedPnl = 0;
          let unrealizedPnlPercent = 0;
          
          // Fix: Extract price from PriceData object
          const price = priceData?.price || 0;
          if (price > 0 && entryPrice > 0) {
            if (side === 'long') {
              unrealizedPnl = (price - entryPrice) * quantity;
              unrealizedPnlPercent = ((price - entryPrice) / entryPrice) * 100;
            } else {
              unrealizedPnl = (entryPrice - price) * quantity;
              unrealizedPnlPercent = ((entryPrice - price) / entryPrice) * 100;
            }
          }
          
          return {
            ...pos,
            currentPrice: price || null,
            unrealizedPnl,
            unrealizedPnlPercent,
          };
        } catch (err) {
          return {
            ...pos,
            currentPrice: null,
            unrealizedPnl: 0,
            unrealizedPnlPercent: 0,
          };
        }
      });
      
      clearTimeout(timeout);
      if (!res.headersSent) {
        return res.json({ positions: positionsWithPrices });
      }
    } catch (error: any) {
      clearTimeout(timeout);
      console.error('[REST Positions Error]', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: error.message, positions: [] });
      }
    }
  });

  // ============================================
  // CORS MIDDLEWARE (for browser requests)
  // ============================================
  const allowedOrigins: string[] = [];
  if (ENV.corsOrigins) {
    allowedOrigins.push(...ENV.corsOrigins.split(',').map(o => o.trim()).filter(Boolean));
  }
  // Always allow localhost in development
  if (!ENV.isProduction) {
    allowedOrigins.push('http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000');
  }
  // Phase 90 — CORS lockdown.
  // Pre-fix: wildcard `*.manus.computer` allowed ANY subdomain (including
  // attacker-registered sandboxes) to make credentialed requests with the
  // victim's session cookie. Now an explicit allowlist from CORS_ORIGINS env.
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Phase 90 — wildcard removed. To allow a Manus sandbox, add the exact
      // origin to CORS_ORIGINS env var.
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'x-trpc-source'],
  }));

  // Phase 90 — Security headers via helmet. Adds X-Frame-Options (clickjack
  // defense), Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy.
  // Content-Security-Policy is left off for now because the SPA has inline
  // <style> injections from chart.tsx — would need nonce/hash to enable safely.
  // Phase 90 — helmet via dynamic import (ESM-friendly; esbuild bundle is ESM).
  try {
    const helmetMod = await import('helmet');
    const helmet = (helmetMod as any).default ?? helmetMod;
    app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }));
    console.log('[Security] helmet middleware enabled');
  } catch (err) {
    console.warn('[Security] helmet not installed — skipping security headers', (err as Error)?.message);
  }

  // ============================================
  // TRPC MIDDLEWARE (rate limited: 30 req/min per user)
  // ============================================
  app.use(
    "/api/trpc",
    generalLimiter,
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // ============================================
  // WEBSOCKET SETUP
  // ============================================
  const wsServer = getMultiWebSocketServer();
  wsServer.initializeNoServer();
  
  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/ws/seer-multi')) {
      wsServer.handleUpgrade(request, socket, head);
    }
  });
  
  // Start price feed service and initialize Socket.IO for real-time price broadcasting
  priceFeedService.start();
  priceFeedService.initialize(server);
  
  // ============================================
  // PRICE FABRIC — Multi-Source Millisecond Price Data (Phase 11C)
  // ============================================
  // Architecture: PriceFabric sits BETWEEN raw sources and priceFeedService.
  // Coinbase WS + Binance WS + CoinGecko REST → PriceFabric → priceFeedService → all consumers
  // Features: dedup, consensus, gap detection, source health, batch DB persistence

  const tradingSymbols = ['BTC-USD', 'ETH-USD', 'SOL-USD'];

  // 1. Start PriceFabric FIRST — it must be ready before any WebSocket feeds start
  try {
    const { getPriceFabric } = await import('../services/PriceFabric');
    const priceFabric = getPriceFabric();
    priceFabric.start();

    // Phase 17: Wire price updates into DynamicCorrelationTracker
    try {
      const { getDynamicCorrelationTracker } = await import('../services/DynamicCorrelationTracker');
      const corrTracker = getDynamicCorrelationTracker();
      priceFeedService.on('price_update', (data: { symbol: string; price: number; timestamp: number }) => {
        corrTracker.recordPrice(data.symbol, data.price, data.timestamp || getActiveClock().now());
      });
    } catch { /* Correlation tracker may not be ready yet — that's OK */ }

    console.log(`[${new Date().toLocaleTimeString()}] 🏭 PriceFabric started — multi-source tick ingestion active`);
  } catch (fabricError: any) {
    console.error(`[${new Date().toLocaleTimeString()}] ❌ PriceFabric failed to start:`, fabricError.message);
  }

  // 2. Start Coinbase WebSocket (PARALLEL feed alongside Binance, FREE, no auth)
  // Ticks now route through PriceFabric → priceFeedService (instead of direct)
  let coinbasePublicWebSocketRef: any = null;
  try {
    const { coinbasePublicWebSocket } = await import('../services/CoinbasePublicWebSocket');
    await coinbasePublicWebSocket.start(tradingSymbols);
    coinbasePublicWebSocketRef = coinbasePublicWebSocket;
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Coinbase Public WebSocket started for: ${tradingSymbols.join(', ')}`);
  } catch (publicWsError: any) {
    console.error(`[${new Date().toLocaleTimeString()}] ❌ Coinbase Public WebSocket failed to start:`, publicWsError.message);
  }

  // 2b. Lead-Lag Tracker (Phase 52) — measure Binance ↔ Coinbase price-move timing
  // Tokyo placement should make Binance lead Coinbase by 50-200ms typical, more
  // during volatility events. This service quantifies the actual lead time so we
  // can either confirm the edge for our infra or feed the delta into consensus.
  let leadLagTrackerRef: any = null;
  try {
    const { getLeadLagTracker } = await import('../services/LeadLagTracker');
    const tracker = getLeadLagTracker();
    tracker.start();
    leadLagTrackerRef = tracker;
    if (coinbasePublicWebSocketRef) {
      coinbasePublicWebSocketRef.on('ticker', (t: any) => {
        const symbol = t.product_id; // already in canonical 'BTC-USD' form
        const price = parseFloat(t.price);
        if (isFinite(price) && price > 0) tracker.pushCoinbase(symbol, price);
        // Phase 53.12 — stash Coinbase top-of-book in a global, symmetric to
        // __binanceSpotBook (which is keyed by Binance native sym). Keyed by
        // canonical SEER symbol "BTC-USD" so the cross-exchange spread agent
        // can pair it directly with the binance side after a cheap symbol map.
        const bid = parseFloat(t.best_bid);
        const ask = parseFloat(t.best_ask);
        const mid = isFinite(bid) && isFinite(ask) && bid > 0 && ask > 0
          ? (bid + ask) / 2
          : (isFinite(price) && price > 0 ? price : NaN);
        if (isFinite(mid)) {
          (global as any).__coinbaseTopOfBook = (global as any).__coinbaseTopOfBook || {};
          (global as any).__coinbaseTopOfBook[symbol] = {
            bidPrice: isFinite(bid) ? bid : mid,
            askPrice: isFinite(ask) ? ask : mid,
            midPrice: mid,
            tradePrice: isFinite(price) ? price : mid,
            receivedAt: getActiveClock().now(),
          };
        }
      });
    }
    // Periodic stats log every 60s — visible signal of whether Binance is leading
    setInterval(() => {
      const counters = tracker.getCounters();
      const stats = tracker.getStats();
      const symbols = Object.keys(stats);
      if (symbols.length === 0) {
        console.log(`[LeadLagTracker] 60s stats: candidates=${counters.candidates} resolved=${counters.resolved} pending=${counters.pending} — waiting for cross-exchange confirmation`);
        return;
      }
      console.log(`[LeadLagTracker] 60s stats: candidates=${counters.candidates} resolved=${counters.resolved} pending=${counters.pending}`);
      for (const s of symbols) {
        const x = stats[s];
        console.log(`  ${s}: n=${x.count} medianLead=${x.medianLeadMs}ms p95=${x.p95LeadMs}ms binanceLeads=${(x.binanceLeadFraction*100).toFixed(0)}% avgMove=${x.avgMoveBps.toFixed(1)}bps`);
      }
    }, 60_000);
    console.log(`[${new Date().toLocaleTimeString()}] 🔬 LeadLagTracker started — Binance ↔ Coinbase timing measurement`);
  } catch (llErr: any) {
    console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ LeadLagTracker failed to start:`, llErr.message);
  }

  // 3. Binance WebSocket — DISABLED (Phase 4)
  //
  // Binance's WS endpoint (stream.binance.com:9443) is geo-blocked for US-East
  // hosts with HTTP 451.  Our prod is deployed in US-East, so subscribing
  // produced nothing but reconnect spam and never yielded a single tick.
  // PriceFabric already has three independent sources:
  //   1. Coinbase WS  (primary, low-latency)
  //   2. CoinGecko    (30s cross-validator)
  //   3. Binance REST (tier-3 fallback — the REST endpoints are NOT geo-blocked
  //                    the same way; only the WS is restricted for US hosts)
  // so the WS tier was pure cost (reconnect storms, misleading `source: binance`
  // health signals) with zero benefit.  Dropped to keep the fabric clean and
  // avoid confusing on-call when the logs show "Binance 451" every 5s.
  if (process.env.ENABLE_BINANCE_WS === '1') {
    try {
      const { getBinanceWebSocketManager } = await import('../exchanges/BinanceWebSocketManager');
      const { getPriceFabric } = await import('../services/PriceFabric');
      const binanceWs = getBinanceWebSocketManager();
      const priceFabric = getPriceFabric();

      const binanceSymbolMap: Record<string, string> = {
        'BTC-USD': 'BTCUSDT',
        'ETH-USD': 'ETHUSDT',
        'SOL-USD': 'SOLUSDT',
      };
      const reverseBinanceMap: Record<string, string> = {};
      for (const [seer, binance] of Object.entries(binanceSymbolMap)) {
        reverseBinanceMap[binance.toUpperCase()] = seer;
      }

      for (const seerSymbol of tradingSymbols) {
        const binanceSymbol = binanceSymbolMap[seerSymbol];
        if (binanceSymbol) {
          // Phase 50 — Tokyo data fidelity. Five channels per symbol:
          //   bookTicker  → real-time best bid/ask (primary tick driver)
          //   trade       → realized fills (OrderFlowAnalyst raw input)
          //   aggTrade    → aggregated taker prints (less noisy fill signal)
          //   depth@100ms → L2 book diffs (OrderbookImbalanceAgent fuel)
          //   kline_1s    → 1-second candles (sub-minute regime detection)
          binanceWs.subscribe({
            symbol: binanceSymbol,
            streams: ['bookTicker', 'trade', 'aggTrade', 'depth@100ms', 'kline_1s'],
          });
        }
      }

      binanceWs.on('trade', (trade: { symbol: string; price: number; quantity: number; timestamp: number }) => {
        const canonicalSymbol = reverseBinanceMap[trade.symbol?.toUpperCase()] || trade.symbol;
        priceFabric.ingestTick({
          symbol: canonicalSymbol,
          price: trade.price,
          volume: trade.quantity,
          timestampMs: trade.timestamp,
          receivedAtMs: getActiveClock().now(),
          source: 'binance',
        });
      });

      // bookTicker → primary fast-path price feed. Mid-price ingested as a tick;
      // PriceFabric's median-of-recent-ticks consensus naturally weights this
      // alongside Coinbase ticks without us hardcoding a primary/secondary order.
      binanceWs.on('bookTicker', (book: import('../exchanges/BinanceWebSocketManager').BookTickerEvent) => {
        const canonicalSymbol = reverseBinanceMap[book.symbol?.toUpperCase()] || book.symbol;
        priceFabric.ingestTick({
          symbol: canonicalSymbol,
          price: book.midPrice,
          volume: 0, // bookTicker has no traded volume — it's a quote update
          timestampMs: book.receivedAtMs,
          receivedAtMs: book.receivedAtMs,
          source: 'binance',
        });
        // Feed Binance side of LeadLagTracker (Phase 52). bookTicker is the
        // best stream for this purpose — it fires on every quote change.
        if (leadLagTrackerRef) {
          leadLagTrackerRef.pushBinance(canonicalSymbol, book.midPrice, book.receivedAtMs);
        }
        // Phase 53.4 — stash spot top-of-book on a global, symmetric to the
        // futures stash (__binanceFuturesBook). PerpSpotPremiumAgent reads
        // both to derive the perp-vs-spot premium and detect when perp leads.
        // Key by Binance native symbol (BTCUSDT etc.) so it pairs trivially.
        const rawBinSym = book.symbol?.toUpperCase();
        if (rawBinSym) {
          (global as any).__binanceSpotBook = (global as any).__binanceSpotBook || {};
          (global as any).__binanceSpotBook[rawBinSym] = {
            bidPrice: book.bidPrice,
            askPrice: book.askPrice,
            midPrice: book.midPrice,
            bidQty: book.bidQty,
            askQty: book.askQty,
            tradeTime: book.receivedAtMs,
            eventTime: book.receivedAtMs,
          };
        }
      });

      // aggTrade → aggregated taker fills (one event per taker order, regardless
      // of how many maker orders it crossed). Cleaner than `trade` for taker-flow
      // analysis. Forward as a tick at the trade price for additional consensus
      // weight on actual print prices.
      binanceWs.on('aggTrade', (agg: { symbol: string; price: number; quantity: number; timestamp: number; isBuyerMaker: boolean }) => {
        const canonicalSymbol = reverseBinanceMap[agg.symbol?.toUpperCase()] || agg.symbol;
        priceFabric.ingestTick({
          symbol: canonicalSymbol,
          price: agg.price,
          volume: agg.quantity,
          timestampMs: agg.timestamp,
          receivedAtMs: getActiveClock().now(),
          source: 'binance',
        });
        // Phase 53.7 — symmetric to perp: stash spot taker fills in a ring
        // global so SpotTakerFlowAgent can compute spot CVD and pair it with
        // PerpTakerFlowAgent for divergence detection (perp-only buying = noise,
        // perp+spot agreement = real demand).
        const rawBinSym = agg.symbol?.toUpperCase();
        if (rawBinSym && isFinite(agg.price) && isFinite(agg.quantity) && agg.quantity > 0) {
          (global as any).__binanceSpotTakerFlow = (global as any).__binanceSpotTakerFlow || {};
          const ring = (global as any).__binanceSpotTakerFlow[rawBinSym] || [];
          ring.push({
            // isBuyerMaker === true means the buyer was the maker (taker SOLD).
            side: agg.isBuyerMaker ? 'sell' : 'buy',
            price: agg.price,
            qty: agg.quantity,
            notional: agg.price * agg.quantity,
            timestamp: agg.timestamp,
          });
          if (ring.length > 500) ring.splice(0, ring.length - 500);
          (global as any).__binanceSpotTakerFlow[rawBinSym] = ring;
        }
      });

      // depth@100ms and kline_1s emit on the WS manager too — handlers in the
      // codebase consume them via .on('depth') and .on('kline'). We don't need
      // to re-emit here; whoever wants them can subscribe to the manager events
      // directly. Subscribing to the streams above is what unlocks them.

      console.log(`[${new Date().toLocaleTimeString()}] ✅ Binance WebSocket started (ENABLE_BINANCE_WS=1, channels=bookTicker+trade+aggTrade+depth@100ms+kline_1s, μs timestamps): ${Object.values(binanceSymbolMap).join(', ')}`);
    } catch (binanceWsError: any) {
      console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Binance WebSocket failed to start:`, binanceWsError.message);
    }
  } else {
    console.log(`[${new Date().toLocaleTimeString()}] ℹ️ Binance WebSocket skipped (US-East geo-blocked; set ENABLE_BINANCE_WS=1 to force)`);
  }

  // 3b. Binance Futures (USDT-M perps) WS — Phase 52. Liquidation cascades on
  // perps lead spot price by 1-3 seconds (academic + empirical). Subscribing to
  // forceOrder + markPrice gives us:
  //   - forceOrder: real-time liquidation events (size + side + price)
  //   - markPrice@1s: perp mark price + funding rate + premium index every 1s
  // Tokyo placement makes fstream.binance.com directly reachable (no geo-block).
  if (process.env.ENABLE_BINANCE_FUTURES_WS !== '0') {
    try {
      const WebSocket = (await import('ws')).default;
      const futuresSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
      // Phase 52.3 — markPrice@1s closes the connection immediately and the
      // base markPrice stream emits nothing in observed windows. Replace with
      // bookTicker on futures (proven 13 msgs/sec on BTCUSDT) for perp top-of
      // -book; pair with spot bookTicker to compute the premium. forceOrder
      // stays — fires only on actual liquidations (rare in calm markets, that's
      // the point: when it fires, it matters).
      // Phase 53.5 — perp taker-flow for CVD / imbalance / outlier detection.
      // Phase 82.4 — switched from @aggTrade to @trade because Binance Futures
      // USDT-M's @aggTrade stream silently emits ZERO messages (verified live:
      // direct subscription returned 0 fills in 10s while @bookTicker on the
      // same WS got 2113 messages). @trade returns 1197 fills in 8s with the
      // same `s/p/q/m/T` fields we need. This is the single fix that
      // resurrects 6 zombie agents (PerpTakerFlow, VWAPDivergence, TradeBurst,
      // TradeSizeOutlier, CVDDivergence, PriceImpact) — all of them depend on
      // `__binancePerpTakerFlow` being populated.
      // Phase 53.8 — @depth5@100ms for top-5 order book imbalance.
      const streams = futuresSymbols
        .flatMap(s => [
          `${s.toLowerCase()}@forceOrder`,
          `${s.toLowerCase()}@bookTicker`,
          `${s.toLowerCase()}@trade`,
          `${s.toLowerCase()}@depth5@100ms`,
        ])
        .join('/');
      // Note: futures stream rejects ?timeUnit=MICROSECOND (400 Bad Request).
      // Spot supports it, futures doesn't yet. Stay on millisecond for futures.
      const futuresUrl = `wss://fstream.binance.com/stream?streams=${streams}`;
      const futuresWs = new WebSocket(futuresUrl);
      let liquidationCount = 0;
      futuresWs.on('open', () => {
        console.log(`[${new Date().toLocaleTimeString()}] 🚨 Binance Futures WS connected: forceOrder + markPrice for ${futuresSymbols.join(', ')}`);
      });
      futuresWs.on('message', (raw: any) => {
        try {
          const msg = JSON.parse(raw.toString());
          const stream = msg.stream;
          const data = msg.data;
          if (!stream || !data) return;
          if (stream.includes('@forceOrder')) {
            // Liquidation event — emit + log (consumers can hook into a global emitter later)
            const o = data.o;
            if (!o) return;
            liquidationCount++;
            const sideText = o.S === 'BUY' ? 'SHORT-LIQ' : 'LONG-LIQ';
            const value = parseFloat(o.q) * parseFloat(o.p);
            console.log(`[FuturesWS] 💥 ${sideText} ${o.s} qty=${o.q} @ $${o.p} (notional $${value.toFixed(0)})`);
            // Tag-attach a simple in-memory global so liquidation agents can consume.
            (global as any).__lastLiquidations = (global as any).__lastLiquidations || [];
            (global as any).__lastLiquidations.push({
              symbol: o.s, side: sideText, price: parseFloat(o.p), quantity: parseFloat(o.q),
              notional: value, timestamp: o.T,
            });
            if ((global as any).__lastLiquidations.length > 500) (global as any).__lastLiquidations.shift();
          } else if (stream.includes('@bookTicker')) {
            // Perp top-of-book — best bid/ask on USDT-M perpetual. Pair with
            // spot bookTicker to derive perp-vs-spot premium for funding-flow
            // and lead/lag analysis (perps often lead spot by 1-3s).
            const bid = parseFloat(data.b);
            const ask = parseFloat(data.a);
            (global as any).__binanceFuturesBook = (global as any).__binanceFuturesBook || {};
            (global as any).__binanceFuturesBook[data.s] = {
              bidPrice: bid,
              askPrice: ask,
              midPrice: (bid + ask) / 2,
              bidQty: parseFloat(data.B),
              askQty: parseFloat(data.A),
              tradeTime: data.T,
              eventTime: data.E,
            };
          } else if (stream.includes('@trade')) {
            // Phase 82.4 — perp trades (was @aggTrade, but Binance Futures
            // @aggTrade silently emits 0 messages — see boot comment above).
            // @trade has the same `m`/`p`/`q`/`s`/`T` fields, just per-fill
            // instead of per-aggregated-taker-order. Net effect on imbalance
            // calculation is identical (we're summing notional × side anyway).
            // data.m === true means BUYER is maker (taker SOLD); false = taker BOUGHT.
            const price = parseFloat(data.p);
            const qty = parseFloat(data.q);
            if (!isFinite(price) || !isFinite(qty) || qty <= 0) return;
            const notional = price * qty;
            const side: 'buy' | 'sell' = data.m === true ? 'sell' : 'buy';
            (global as any).__binancePerpTakerFlow = (global as any).__binancePerpTakerFlow || {};
            const ring = (global as any).__binancePerpTakerFlow[data.s] || [];
            ring.push({ side, price, qty, notional, timestamp: data.T });
            // Keep last 500 fills per symbol (~5-10s on liquid majors at ~100 fills/sec).
            if (ring.length > 500) ring.splice(0, ring.length - 500);
            (global as any).__binancePerpTakerFlow[data.s] = ring;
          } else if (stream.includes('@depth5')) {
            // Phase 53.8 — perp top-5 order book. Stream pushes top-5 bids
            // and asks every 100ms. Stash latest snapshot per symbol so the
            // PerpDepthImbalanceAgent can compute (Σbid_qty - Σask_qty) /
            // (Σbid_qty + Σask_qty) over the depth.
            // Payload shape (futures partial depth): { e, E, T, s, U, u, pu,
            //   b: [[price,qty], ...], a: [[price,qty], ...] }
            const sym = data.s as string | undefined;
            const bids = data.b as Array<[string, string]> | undefined;
            const asks = data.a as Array<[string, string]> | undefined;
            if (!sym || !Array.isArray(bids) || !Array.isArray(asks)) return;
            const bidLevels = bids.slice(0, 5).map(([p, q]) => ({
              price: parseFloat(p),
              qty: parseFloat(q),
            })).filter(l => isFinite(l.price) && isFinite(l.qty));
            const askLevels = asks.slice(0, 5).map(([p, q]) => ({
              price: parseFloat(p),
              qty: parseFloat(q),
            })).filter(l => isFinite(l.price) && isFinite(l.qty));
            (global as any).__binancePerpDepth5 = (global as any).__binancePerpDepth5 || {};
            (global as any).__binancePerpDepth5[sym] = {
              bids: bidLevels,
              asks: askLevels,
              eventTime: data.E,
              tradeTime: data.T,
              receivedAt: getActiveClock().now(),
            };
          }
        } catch {/* swallow malformed */}
      });
      futuresWs.on('error', (err: any) => {
        console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Futures WS error:`, err.message);
      });
      futuresWs.on('close', (code: number) => {
        console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Futures WS closed (code ${code}) — reconnect on next start cycle`);
      });
      // Periodic stats log — Phase 82.3: also reports aggTrade ring sizes
      // and depth5 key counts so we can SEE if Phase 53.5/53.8 streams are
      // actually being received. If perpTakerFlow rings stay at 0 fills,
      // the Binance subscription is being silently dropped.
      setInterval(() => {
        const book = (global as any).__binanceFuturesBook || {};
        const liq = (global as any).__lastLiquidations || [];
        const recentLiq = liq.filter((l: any) => getActiveClock().now() - l.timestamp < 60_000).length;
        const perpSpotDeltas: string[] = [];
        for (const sym of Object.keys(book)) {
          const perp = book[sym].midPrice;
          perpSpotDeltas.push(`${sym}=$${perp.toFixed(2)}`);
        }
        const perpFlow = (global as any).__binancePerpTakerFlow || {};
        const perpDepth = (global as any).__binancePerpDepth5 || {};
        const spotFlow = (global as any).__binanceSpotTakerFlow || {};
        const flowSummary = Object.keys(perpFlow).map(s => `${s}=${perpFlow[s].length}`).join(' ') || 'EMPTY';
        const depthSummary = Object.keys(perpDepth).length;
        const spotSummary = Object.keys(spotFlow).map(s => `${s}=${spotFlow[s].length}`).join(' ') || 'EMPTY';
        console.log(
          `[FuturesWS] 60s: ${recentLiq} liq | books: ${perpSpotDeltas.join(' ')} | ` +
          `perpFlow: ${flowSummary} | spotFlow: ${spotSummary} | depth5_syms: ${depthSummary} | totalLiq: ${liquidationCount}`,
        );
      }, 60_000);
    } catch (futErr: any) {
      console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Binance Futures WS failed:`, futErr.message);
    }
  }

  // 4. Start CoinGecko price verifier (cross-validates WebSocket prices every 30s)
  try {
    const { getCoinGeckoVerifier } = await import('../services/CoinGeckoVerifier');
    getCoinGeckoVerifier().start(tradingSymbols);
    console.log(`[${new Date().toLocaleTimeString()}] 🔍 CoinGecko verifier started (30s price validation)`);
  } catch (geckoError: any) {
    console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ CoinGecko verifier failed to start:`, geckoError.message);
  }

  // 5. Keep Binance REST fallback as 3rd-tier backup (unchanged from before)
  try {
    const { binanceRestFallback } = await import('../services/BinanceRestFallback');
    await binanceRestFallback.start(tradingSymbols);
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Binance REST fallback initialized (standby mode)`);
  } catch (fallbackError: any) {
    console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Binance REST fallback failed to initialize:`, fallbackError.message);
  }
  
  // 6. Phase 13E: Start Data Gap Resilience (reconnect backfill + REST polling fallback)
  try {
    const { dataGapResilience } = await import('../services/DataGapResilience');
    dataGapResilience.start(tradingSymbols);
    console.log(`[${new Date().toLocaleTimeString()}] 🛡️ DataGapResilience started — reconnect backfill + REST fallback active`);
  } catch (resilienceError: any) {
    console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ DataGapResilience failed to start:`, resilienceError.message);
  }

  // ============================================
  // DATABASE PRE-WARMING & CACHE POPULATION
  // ============================================
  // Initialize database connection pool on startup to avoid cold start delays
  try {
    const { getDb } = await import('../db');
    const { paperPositions } = await import('../../drizzle/schema');
    const { eq, and } = await import('drizzle-orm');
    const { users } = await import('../../drizzle/schema');
    
    console.log(`[${new Date().toLocaleTimeString()}] 🔄 Pre-warming database connection...`);
    const db = await getDb();
    if (db) {
      console.log(`[${new Date().toLocaleTimeString()}] ✅ Database connection pool ready`);
      
      // Update health state for database
      import('../routers/healthRouter').then(({ updateHealthState }) => {
        updateHealthState('database', { connected: true, lastQuery: getActiveClock().now() });
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Database health state updated`);
      }).catch(() => {});
      
      // Pre-populate position cache for all active users
      console.log(`[${new Date().toLocaleTimeString()}] 🔄 Pre-populating position cache...`);
      try {
        // Get all users with open positions
        const usersWithPositions = await db
          .selectDistinct({ userId: paperPositions.userId })
          .from(paperPositions)
          .where(eq(paperPositions.status, 'open'));
        
        for (const { userId } of usersWithPositions) {
          const openPositions = await db
            .select()
            .from(paperPositions)
            .where(and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'open')));
          
          positionCache.set(userId, { positions: openPositions, timestamp: getActiveClock().now() });
          console.log(`[${new Date().toLocaleTimeString()}] ✅ Cached ${openPositions.length} positions for user ${userId}`);
        }
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Position cache pre-populated for ${usersWithPositions.length} users`);
      } catch (cacheError) {
        console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Position cache pre-population failed:`, cacheError);
      }
    } else {
      console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Database not available`);
    }
  } catch (error) {
    console.error(`[${new Date().toLocaleTimeString()}] ❌ Database pre-warming failed:`, error);
  }

  // ============================================
  // HISTORICAL CANDLE BACKFILL + CACHE SEED  (Phase 4)
  // ============================================
  // The previous boot left both the `historicalCandles` table and the
  // in-memory WebSocketCandleCache empty, which silently tripped the
  // min-candles entry gate and starved MacroAnalyst's correlation math. We
  // now (1) lazy-backfill any empty (symbol, interval) pairs from the public
  // Coinbase Exchange API, then (2) seed the in-memory cache from the DB so
  // agents see historical context on the very first tick. Both run
  // non-blocking in the background — they must never delay server startup
  // or block trading loops.
  (async () => {
    try {
      const { backfillIfEmpty } = await import('../services/CoinbaseCandleBackfill');
      // Use service's full default interval list: 1d / 4h / 1h / 5m / 1m
      // (4h is synthesized from 1h — see CoinbaseCandleBackfill.ts).
      // Prev call passed only ['1d','1h','5m'], leaving 4h and 1m empty and
      // flooding logs with "No candles found for … 4h/1m" every agent cycle.
      await backfillIfEmpty(tradingSymbols);
    } catch (backfillErr: any) {
      console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Coinbase backfill failed:`, backfillErr?.message || backfillErr);
    }

    try {
      const { seedCandleCache } = await import('../WebSocketCandleCache');
      await seedCandleCache(tradingSymbols);
      console.log(`[${new Date().toLocaleTimeString()}] ✅ WebSocketCandleCache seeded from DB`);
    } catch (seedErr: any) {
      console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Candle cache seed failed:`, seedErr?.message || seedErr);
    }

    // ─── Phase 83 — TraderBrain v1 (dry-run mode) ──────────────────────
    // Starts the single-brain decision pipeline alongside the existing IEM.
    // In dryRun mode the brain decides + records to brainDecisions but does
    // NOT execute. Side-by-side comparison vs live IEM via DecisionTrace.
    // Promotion to live: setConfig({ dryRun: false }) after we validate the
    // brain's decisions match (or improve on) IEM in a 24h paper window.
    try {
      const { getSensorium } = await import('../brain/Sensorium');
      const { getDecisionTrace } = await import('../brain/DecisionTrace');
      const { getTraderBrain } = await import('../brain/TraderBrain');
      const { startSensorWiring } = await import('../brain/SensorWiring');
      const { getPatternPopulator } = await import('../brain/PatternPopulator');

      // Force-construct singletons.
      void getSensorium();
      void getDecisionTrace();
      startSensorWiring();
      // Phase 88 — alpha library writer. Listens to brain_position_opened/closed
      // events from BrainExecutor and UPSERTs into winningPatterns. Must start
      // BEFORE the brain so the BrainExecutor's event listeners are attached
      // before the first open/close event fires.
      getPatternPopulator().start();

      // Phase 90 — DB retention. DB grew to 14.5 GB; nightly sweep deletes
      // old rows from append-only log tables to keep query times sane.
      // First sweep runs 5 min after boot.
      try {
        const { getDataRetentionService } = await import('../services/DataRetentionService');
        getDataRetentionService().start();
      } catch (err) {
        console.warn('[DataRetention] failed to start:', (err as Error)?.message);
      }

      const brain = getTraderBrain();
      // Phase 83.2 — LIVE MODE. Brain has execution authority over the 6
      // open positions. 60s warm-up after start() before any execution
      // fires (gives sensors time to populate). IEM still ticks but its
      // exit signals will hit a position the brain has already closed
      // (BrainExecutor notifies IEM to drop closed positions from its map).
      brain.configure({ dryRun: false });
      brain.start();
      console.log(`[${new Date().toLocaleTimeString()}] 🧠⚠️  TraderBrain v1 started LIVE — execution authority granted. 60s warm-up active.`);
    } catch (brainErr: any) {
      console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ TraderBrain start failed:`, brainErr?.message || brainErr);
    }
  })();

  // ============================================
  // STATIC FILES / VITE
  // ============================================
  console.log(`[${new Date().toLocaleTimeString()}] 🔧 Setting up static files/Vite...`);
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Static files served`);
  } else {
    console.log(`[${new Date().toLocaleTimeString()}] 🔧 Starting Vite setup (dev mode)...`);
    await setupVite(app, server);
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Vite setup complete`);
  }

  // ============================================
  // START SERVER
  // ============================================
  console.log(`[${new Date().toLocaleTimeString()}] 🔍 Finding available port...`);
  const port = await findAvailablePort(3000);
  console.log(`[${new Date().toLocaleTimeString()}] ✅ Found available port: ${port}`);
  
  server.listen(port, "0.0.0.0", async () => {
    console.log(`[${new Date().toLocaleTimeString()}] Server running on http://localhost:${port}/`);
    
    // Phase 22: Initialize Trading Pipeline Logger — dedicated logging for all trading decisions
    try {
      const { initPipelineLogger } = await import('../services/TradingPipelineLogger');
      initPipelineLogger();
      console.log(`[${new Date().toLocaleTimeString()}] 📋 Trading Pipeline Logger initialized — writing to logs/trading-pipeline.log`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to initialize pipeline logger:`, error);
    }

    // Phase 13: Start TradingSilenceWatchdog — detects 100%-rejection + no-trade-for-hours
    // conditions that previously went silent (we had 3 days of zero trades 2026-04-21 → 04-24
    // because every signal was rejected and nothing alarmed). Watchdog runs every 5 min and
    // surfaces structured alarms both to console and to the pipeline log (RISK_CHECK event).
    try {
      const { startTradingSilenceWatchdog } = await import('../services/TradingSilenceWatchdog');
      startTradingSilenceWatchdog();
      console.log(`[${new Date().toLocaleTimeString()}] 🐕 Trading Silence Watchdog started — polls every 5 min`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start silence watchdog:`, error);
    }

    // Phase 73: Start EngineHeartbeat watchdog at BOOT — never gated on a
    // specific user session. Previously start() was inside UserTradingSession's
    // init try-block, so if that block threw early the watchdog never started.
    // The watchdog now runs unconditionally for the lifetime of the process.
    try {
      const { getEngineHeartbeat } = await import('../services/EngineHeartbeat');
      const hb = getEngineHeartbeat();
      hb.start();
      hb.on('auto_halt', (info: { reason: string }) => {
        console.error(`[Boot] 🚨 EngineHeartbeat AUTO-HALT fired: ${info.reason}`);
      });
      console.log(`[${new Date().toLocaleTimeString()}] 🫀 EngineHeartbeat started at boot (Phase 73)`);

      // Phase 74 — Periodic data-consistency check across all users with
      // open positions. Surfaces tradingMode mismatches and stale wallet
      // rows that produce the "header says 39% / DB says 70%" symptom.
      setInterval(async () => {
        try {
          const { getDb } = await import('../db');
          const { users, paperPositions } = await import('../../drizzle/schema');
          const { sql } = await import('drizzle-orm');
          const db = await getDb();
          if (!db) return;
          const activeUsers: { userId: number }[] = await db
            .selectDistinct({ userId: paperPositions.userId })
            .from(paperPositions)
            .where(sql`status = 'open'`);
          for (const { userId } of activeUsers) {
            await hb.runDataConsistencyCheck(userId);
          }
        } catch (e) {
          // Best-effort
        }
      }, 5 * 60 * 1000); // Every 5 min
      console.log(`[${new Date().toLocaleTimeString()}] 🔍 Phase 74 data-consistency watchdog active (5min cadence)`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start EngineHeartbeat at boot:`, error);
    }

    // Phase 70 — Boot AgentCorrelationTracker. Computes the pairwise agent
    // correlation matrix every 6h and serves it to BayesianAggregator. Without
    // this, the Bayesian path falls back to identity correlation (= naive).
    try {
      const { schedulePeriodicRecompute } = await import('../services/AgentCorrelationTracker');
      schedulePeriodicRecompute(6 * 60 * 60 * 1000);
      console.log(`[${new Date().toLocaleTimeString()}] 🔗 Phase 70 AgentCorrelationTracker active (6h cadence)`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start AgentCorrelationTracker:`, error);
    }

    // Phase 14A: Start GlobalMarketEngine — always-on market observation
    // This runs 29 agents per symbol ONCE for ALL users (vs N duplicated per-user engines)
    // Must start BEFORE background engine manager so global signals are available
    try {
      const { getGlobalMarketEngine } = await import('../services/GlobalMarketEngine');
      await getGlobalMarketEngine().start();
      console.log(`[${new Date().toLocaleTimeString()}] 🌍 GlobalMarketEngine started — always-on market observation active`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start GlobalMarketEngine:`, error);
    }

    // Phase 14B: Start UserSessionManager — lightweight per-user sessions
    // Must start AFTER GlobalMarketEngine so signals are available
    try {
      const { getUserSessionManager } = await import('../services/UserSessionManager');
      await getUserSessionManager().init();
      console.log(`[${new Date().toLocaleTimeString()}] 👤 UserSessionManager started — per-user trading sessions active`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start UserSessionManager:`, error);
    }

    // Initialize background engine manager after server is ready
    // This auto-starts engines for users with configured exchanges
    // NOTE: Phase 14D will eventually replace this with UserSessionManager
    try {
      const { initBackgroundEngineManager } = await import('../services/backgroundEngineManager');
      await initBackgroundEngineManager();
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to initialize background engine manager:`, error);
    }
    
    // Initialize ML Integration Service
    // This starts the optimization scheduler and enables ML prediction agents
    try {
      const { getMLIntegrationService } = await import('../services/MLIntegrationService');
      const mlService = getMLIntegrationService();
      await mlService.initialize();
      console.log(`[${new Date().toLocaleTimeString()}] ✅ ML Integration Service initialized`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to initialize ML Integration Service:`, error);
    }

    // Start memory monitor — periodic sampling with alerts at 80%/90% of limit
    try {
      const { startMemoryMonitor } = await import('../services/MemoryMonitor');
      startMemoryMonitor();
      console.log(`[${new Date().toLocaleTimeString()}] ✅ Memory Monitor started`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start Memory Monitor:`, error);
    }

    // Phase 42: Start MemoryGuard — aggressive memory management for 100% uptime
    try {
      const { startMemoryGuard } = await import('../services/MemoryGuard');
      startMemoryGuard();
      console.log(`[${new Date().toLocaleTimeString()}] ✅ MemoryGuard started`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start MemoryGuard:`, error);
    }

    // Phase 11B: Start Position Guardian — independent crash-safe position protection
    // This runs INDEPENDENTLY of the trading engine. Even if the engine is stopped,
    // the Guardian ensures positions are never left unmonitored (dead man's switch).
    try {
      const { getPositionGuardian } = await import('../services/PositionGuardian');
      const guardian = getPositionGuardian({ userId: 1 }); // Default user — backgroundEngineManager handles multi-user
      guardian.start();
      console.log(`[${new Date().toLocaleTimeString()}] 🛡️ Position Guardian started — crash-safe position protection active`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start Position Guardian:`, error);
    }

    // Phase 17: Validate unified TradingConfig at startup (catches misconfigurations early)
    try {
      const { getTradingConfig, validateConfig } = await import('../config/TradingConfig');
      const errors = validateConfig(getTradingConfig());
      if (errors.length > 0) {
        console.error(`[${new Date().toLocaleTimeString()}] ⚠️ TradingConfig has ${errors.length} validation errors — check config`);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] ✅ TradingConfig validated — no conflicts`);
      }
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ TradingConfig validation failed:`, error);
    }

    // Phase 17: Load historical returns for VaR calculation
    try {
      const { loadHistoricalReturns } = await import('../services/VaRRiskGate');
      const count = await loadHistoricalReturns();
      console.log(`[${new Date().toLocaleTimeString()}] 📊 VaR Risk Gate: loaded ${count} historical returns`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ VaR historical returns failed:`, error);
    }

    // Phase 17: Start Dynamic Correlation Tracker
    try {
      const { getDynamicCorrelationTracker } = await import('../services/DynamicCorrelationTracker');
      getDynamicCorrelationTracker().start();
      console.log(`[${new Date().toLocaleTimeString()}] 📈 Dynamic Correlation Tracker started`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Dynamic Correlation Tracker failed:`, error);
    }

    // Phase 15F: Start Platform Health Aggregator — unified monitoring of all components
    try {
      const { getPlatformHealthAggregator } = await import('../services/PlatformHealthAggregator');
      const healthAgg = getPlatformHealthAggregator();
      await healthAgg.loadWebhooksFromDb(); // Phase 16: Load webhook configs
      await healthAgg.start();
      console.log(`[${new Date().toLocaleTimeString()}] 📊 Platform Health Aggregator started`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start Platform Health Aggregator:`, error);
    }

    // Phase 16: Start Agent Alpha Validator — statistical alpha validation every 6 hours
    try {
      const { getAgentAlphaValidator } = await import('../services/AgentAlphaValidator');
      await getAgentAlphaValidator().start();
      console.log(`[${new Date().toLocaleTimeString()}] 🔬 Agent Alpha Validator started`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start Agent Alpha Validator:`, error);
    }

    // Phase 16: Start Adaptive Consensus Engine — dynamically updates agent weights from alpha data
    try {
      const { getAdaptiveConsensusEngine } = await import('../services/AdaptiveConsensusEngine');
      getAdaptiveConsensusEngine(1).start();
      console.log(`[${new Date().toLocaleTimeString()}] 🧠 Adaptive Consensus Engine started`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to start Adaptive Consensus Engine:`, error);
    }

    // Phase 17: Run Walk-Forward Optimizer on startup (async, non-blocking)
    // Also schedules weekly re-runs to detect parameter drift
    try {
      const { getWalkForwardOptimizer } = await import('../services/WalkForwardOptimizer');
      const wfo = getWalkForwardOptimizer();
      // Run initial optimization in background (don't block startup)
      wfo.runOptimization().catch(err => {
        console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Walk-forward optimization failed:`, (err as Error)?.message);
      });
      // Schedule weekly re-runs (every 7 days)
      // Phase 19: Store interval ref for shutdown cleanup
      const wfoInterval = setInterval(() => {
        wfo.runOptimization().catch(err => {
          console.warn('[WalkForwardOptimizer] Weekly run failed:', (err as Error)?.message);
        });
      }, 7 * 24 * 60 * 60 * 1000);
      // Store on wfo object so it can be cleared on shutdown
      (wfo as any)._weeklyInterval = wfoInterval;
      console.log(`[${new Date().toLocaleTimeString()}] Walk-Forward Optimizer initialized (runs weekly)`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Walk-Forward Optimizer failed:`, error);
    }

    // Phase 22: Start Monitoring Framework (SystemHeartbeat, ServiceEventLogger,
    // APIConnectionMonitor, WebSocketHealthMonitor, etc.)
    // This was previously NEVER CALLED — all monitoring services existed but were dormant.
    try {
      const { startMonitoringFramework } = await import('../monitoring/index');
      await startMonitoringFramework('Engine startup');
      console.log(`[${new Date().toLocaleTimeString()}] 📊 Monitoring Framework started (10 services)`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Monitoring Framework failed:`, error);
    }

    // Phase 22: Start Audit Logger (tick heartbeat, agent signals, consensus, trade decisions,
    // slow agent activity, API call logging — all to database for 24/7 audit trail)
    try {
      const { getAuditLogger } = await import('../services/AuditLogger');
      const auditLogger = getAuditLogger();
      await auditLogger.start();
      console.log(`[${new Date().toLocaleTimeString()}] 📝 Audit Logger started (6 log categories)`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Audit Logger failed:`, error);
    }
  });

  // Graceful shutdown
  processManager.registerCleanup('server', async () => {
    console.log('[Server] Shutting down...');
    
    // Phase 14B: Stop UserSessionManager FIRST (stops all per-user sessions)
    try {
      const { getUserSessionManager } = await import('../services/UserSessionManager');
      await getUserSessionManager().stop();
    } catch { /* may not be initialized */ }

    // Phase 14A: Stop GlobalMarketEngine (stops all global analyzers)
    try {
      const { getGlobalMarketEngine } = await import('../services/GlobalMarketEngine');
      await getGlobalMarketEngine().stop();
    } catch { /* may not be initialized */ }

    // Stop background engine manager
    try {
      const { stopBackgroundEngineManager } = await import('../services/backgroundEngineManager');
      await stopBackgroundEngineManager(); // FIX: Now async — waits for all engines to stop gracefully
    } catch (error) {
      console.warn('[Server] Failed to stop background engine manager:', error);
    }
    
    // Phase 16: Stop Adaptive Consensus Engine
    try {
      const { getAdaptiveConsensusEngine } = await import('../services/AdaptiveConsensusEngine');
      getAdaptiveConsensusEngine().stop();
    } catch { /* may not be initialized */ }

    // Phase 16: Stop Agent Alpha Validator
    try {
      const { getAgentAlphaValidator } = await import('../services/AgentAlphaValidator');
      getAgentAlphaValidator().stop();
    } catch { /* may not be initialized */ }

    // Phase 19: Clear Walk-Forward Optimizer weekly interval
    try {
      const { getWalkForwardOptimizer } = await import('../services/WalkForwardOptimizer');
      const wfo = getWalkForwardOptimizer();
      if ((wfo as any)._weeklyInterval) {
        clearInterval((wfo as any)._weeklyInterval);
        (wfo as any)._weeklyInterval = null;
      }
    } catch { /* may not be initialized */ }

    // Phase 17: Stop Dynamic Correlation Tracker
    try {
      const { getDynamicCorrelationTracker } = await import('../services/DynamicCorrelationTracker');
      getDynamicCorrelationTracker().stop();
    } catch { /* may not be initialized */ }

    // Phase 15F: Stop Platform Health Aggregator
    try {
      const { getPlatformHealthAggregator } = await import('../services/PlatformHealthAggregator');
      getPlatformHealthAggregator().stop();
    } catch { /* may not be initialized */ }

    // Phase 22: Stop Monitoring Framework
    try {
      const { stopMonitoringFramework } = await import('../monitoring/index');
      await stopMonitoringFramework();
    } catch { /* may not be initialized */ }

    // Phase 22: Stop Audit Logger
    try {
      const { getAuditLogger } = await import('../services/AuditLogger');
      getAuditLogger().stop();
    } catch { /* may not be initialized */ }

    // Stop memory monitor
    try {
      const { stopMemoryMonitor } = await import('../services/MemoryMonitor');
      stopMemoryMonitor();
    } catch (error) {
      console.warn('[Server] Failed to stop memory monitor:', error);
    }

    // Phase 13E: Stop DataGapResilience
    try {
      const { dataGapResilience } = await import('../services/DataGapResilience');
      dataGapResilience.stop();
    } catch { /* may not be initialized */ }

    // Phase 11C: Stop PriceFabric (flushes remaining tick buffer to DB)
    try {
      const { getPriceFabric } = await import('../services/PriceFabric');
      getPriceFabric().stop();
    } catch { /* may not be initialized */ }

    // Stop CoinGecko verifier
    try {
      const { getCoinGeckoVerifier } = await import('../services/CoinGeckoVerifier');
      getCoinGeckoVerifier().stop();
    } catch { /* may not be initialized */ }

    // Stop Binance WebSocket
    try {
      const { getBinanceWebSocketManager } = await import('../exchanges/BinanceWebSocketManager');
      getBinanceWebSocketManager().unsubscribeAll();
    } catch { /* may not be initialized */ }

    priceFeedService.stop();

    // Phase 11B: Stop PositionGuardian LAST — it's the final safety net
    try {
      const { getPositionGuardian } = await import('../services/PositionGuardian');
      getPositionGuardian().stop();
    } catch { /* may not be initialized */ }

    // Phase 19: Close database and Redis connections (prevents dirty connection state)
    try {
      const { closeDb } = await import('../db');
      await closeDb();
      console.log('[Server] Database pool closed');
    } catch { /* pool may not be initialized */ }

    try {
      const { closeSharedPool } = await import('./sharedPool');
      await closeSharedPool();
      console.log('[Server] Shared auth pool closed');
    } catch { /* pool may not be initialized */ }

    try {
      const { closeRedis } = await import('../hotpath/redisClient');
      await closeRedis();
      console.log('[Server] Redis connection closed');
    } catch { /* Redis may not be initialized */ }

    server.close();
  });
}

console.log(`[${new Date().toLocaleTimeString()}] 📦 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`[${new Date().toLocaleTimeString()}] ✅ Chokidar polling mode enabled (interval: 1000ms)`);
console.log(`[${new Date().toLocaleTimeString()}] 🔧 Starting server...`);

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
