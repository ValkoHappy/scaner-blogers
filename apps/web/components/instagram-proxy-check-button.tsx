"use client";

import { useState } from "react";

type Props = {
  proxyInputId: string;
};

type ProxyCheckState = {
  tone: "success" | "error";
  message: string;
};

export function InstagramProxyCheckButton({ proxyInputId }: Props) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ProxyCheckState | null>(null);

  async function handleClick() {
    const proxyInput = document.getElementById(proxyInputId) as HTMLInputElement | HTMLSelectElement | null;
    const proxyUrl = proxyInput?.value.trim() || "";
    const params = new URLSearchParams();
    if (proxyUrl) params.set("proxyUrl", proxyUrl);

    setChecking(true);
    setResult(null);
    try {
      const response = await fetch(`/api/instagram/proxy-check?${params.toString()}`, {
        cache: "no-store"
      });
      const data = await response.json() as {
        ok?: boolean;
        status?: string;
        message?: string;
        ip?: string;
        instagramStatus?: number;
      };
      if (!response.ok) {
        throw new Error(data.message || `Proxy check failed with HTTP ${response.status}`);
      }
      if (data.ok) {
        const ip = data.ip ? ` Public IP: ${data.ip}.` : "";
        const instagram = typeof data.instagramStatus === "number"
          ? ` Instagram status: ${data.instagramStatus}.`
          : "";
        setResult({
          tone: "success",
          message: `${data.message || "Proxy is ready."}${ip}${instagram}`
        });
      } else {
        setResult({
          tone: "error",
          message: `${humanizeStatus(data.status)}${data.message ? ` ${data.message}` : ""}`.trim()
        });
      }
    } catch (error) {
      setResult({
        tone: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="settings-connect-actions instagram-proxy-check-row">
      <button className="button" type="button" onClick={handleClick} disabled={checking}>
        {checking ? "Checking proxy..." : "Check proxy path"}
      </button>
      {result ? <span className={`instagram-proxy-check-result ${result.tone}`}>{result.message}</span> : null}
    </div>
  );
}

function humanizeStatus(status?: string) {
  switch (status) {
    case "proxy_dns_failed":
      return "Proxy DNS failed.";
    case "proxy_timeout":
      return "Proxy timed out.";
    case "proxy_connect_failed":
      return "Proxy refused the connection.";
    case "ssl_error":
      return "TLS/SSL setup failed.";
    case "instagram_timeout":
      return "Instagram timed out through this proxy.";
    case "instagram_ssl_error":
      return "Instagram TLS/SSL handshake failed through this proxy.";
    case "instagram_unreachable":
      return "Instagram endpoint was unreachable through this proxy.";
    case "proxy_check_spawn_failed":
      return "Local Python proxy check could not start.";
    case "proxy_check_invalid_output":
      return "Proxy check returned unreadable output.";
    default:
      return status ? `${status}.` : "Proxy check failed.";
  }
}
