"use client";

import { useState } from "react";

type Props = {
  proxyInputId: string;
  usernameInputId: string;
};

export function InstagramSessionHelperDownloadButton({ proxyInputId, usernameInputId }: Props) {
  const [error, setError] = useState("");

  function handleClick() {
    const usernameInput = document.getElementById(usernameInputId) as HTMLInputElement | null;
    const proxyInput = document.getElementById(proxyInputId) as HTMLInputElement | HTMLSelectElement | null;

    const username = usernameInput?.value.trim() || "";
    const proxyUrl = proxyInput?.value.trim() || "";

    if (!username) {
      setError("Enter the Instagram login, email, or phone first.");
      usernameInput?.focus();
      return;
    }

    setError("");
    const params = new URLSearchParams({ username });
    if (proxyUrl) params.set("proxyUrl", proxyUrl);
    window.location.assign("/api/instagram/session-helper?" + params.toString());
  }

  return (
    <div className="settings-connect-actions">
      <button className="button" type="button" onClick={handleClick}>
        Download helper .ps1
      </button>
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
