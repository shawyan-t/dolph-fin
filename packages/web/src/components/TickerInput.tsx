"use client";

import { useState, useCallback, useRef, useEffect } from "react";

const COMMON_TICKERS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
  "JPM", "V", "JNJ", "WMT", "PG", "MA", "HD", "CVX", "MRK", "ABBV",
  "KO", "PEP", "COST", "TMO", "DIS", "CSCO", "ADBE", "CRM", "NFLX",
  "AMD", "INTC", "BA", "GS", "MS", "C", "WFC", "BAC", "PYPL",
];

interface TickerInputProps {
  tickers: string[];
  setTickers: (tickers: string[]) => void;
  maxTickers: number;
}

export function TickerInput({ tickers, setTickers, maxTickers }: TickerInputProps) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = useCallback((value: string) => {
    const upper = value.toUpperCase().replace(/[^A-Z-]/g, "");
    setInput(upper);

    if (upper.length > 0) {
      const matches = COMMON_TICKERS
        .filter(t => t.startsWith(upper) && !tickers.includes(t))
        .slice(0, 6);
      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    } else {
      setShowSuggestions(false);
    }
  }, [tickers]);

  const addTicker = useCallback((ticker: string) => {
    const t = ticker.toUpperCase();
    if (t && !tickers.includes(t) && tickers.length < maxTickers) {
      setTickers([...tickers, t]);
    }
    setInput("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [tickers, setTickers, maxTickers]);

  const removeTicker = useCallback((ticker: string) => {
    setTickers(tickers.filter(t => t !== ticker));
  }, [tickers, setTickers]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && input.length >= 1) {
      e.preventDefault();
      addTicker(input);
    }
    if (e.key === "Backspace" && input === "" && tickers.length > 0) {
      removeTicker(tickers[tickers.length - 1]!);
    }
  }, [input, addTicker, tickers, removeTicker]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = () => setShowSuggestions(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return (
    <div className="relative">
      <label className="block text-sm text-neutral-400 mb-2">
        {maxTickers === 1 ? "Enter a ticker symbol" : `Enter up to ${maxTickers} ticker symbols`}
      </label>

      <div className="flex flex-wrap gap-2 items-center bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 focus-within:border-cyan-500/50 transition-colors">
        {/* Ticker pills */}
        {tickers.map((ticker) => (
          <span
            key={ticker}
            className="flex items-center gap-1 bg-[#262626] text-cyan-400 text-sm font-mono px-2.5 py-1 rounded-md"
          >
            {ticker}
            <button
              onClick={() => removeTicker(ticker)}
              className="text-neutral-500 hover:text-white ml-0.5"
            >
              &times;
            </button>
          </span>
        ))}

        {/* Input */}
        {tickers.length < maxTickers && (
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tickers.length === 0 ? "AAPL" : "Add another..."}
            className="flex-1 min-w-[80px] bg-transparent text-white font-mono text-sm outline-none placeholder:text-neutral-600"
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && (
        <div
          className="absolute z-10 top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-[#333] rounded-lg overflow-hidden shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {suggestions.map((ticker) => (
            <button
              key={ticker}
              onClick={() => addTicker(ticker)}
              className="w-full px-3 py-2 text-left text-sm font-mono text-neutral-300 hover:bg-[#262626] hover:text-white transition-colors"
            >
              {ticker}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
