"use client";

import { useEffect } from "react";

type PersistFormStateProps = {
  formId: string;
  storageKey: string;
  names: string[];
};

type SavedValue = string | boolean;
type SavedState = Record<string, SavedValue>;

export function PersistFormState({ formId, storageKey, names }: PersistFormStateProps) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;

    const allowed = new Set(names);
    const keyFor = (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
      if (!allowed.has(element.name)) return null;
      if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
        return `${element.name}:${element.value}`;
      }
      return element.name;
    };

    const restore = () => {
      let saved: SavedState = {};
      try {
        saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as SavedState;
      } catch {
        saved = {};
      }

      for (const element of Array.from(form.elements)) {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
        const key = keyFor(element);
        if (!key || !(key in saved)) continue;

        const value = saved[key];
        if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
          element.checked = value === true;
        } else if (typeof value === "string") {
          element.value = value;
        }
      }
    };

    const save = () => {
      const next: SavedState = {};
      for (const element of Array.from(form.elements)) {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
        const key = keyFor(element);
        if (!key) continue;

        if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
          next[key] = element.checked;
        } else {
          next[key] = element.value;
        }
      }
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    };

    restore();
    form.addEventListener("input", save);
    form.addEventListener("change", save);

    return () => {
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
    };
  }, [formId, names, storageKey]);

  return null;
}
