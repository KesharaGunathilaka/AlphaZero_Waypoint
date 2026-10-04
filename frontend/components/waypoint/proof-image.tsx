"use client";

import { useApiData } from "@/lib/api/use-api";

/** A proof-of-delivery photo or signature, shown through a short-lived link from the API. */
export function ProofImage({ id, kind }: { id: string; kind: string }) {
  const link = useApiData<{ url: string }>(`/attachments/${id}`);
  if (!link.data) return <div className="size-28 animate-pulse rounded-md bg-wp-surface-2" />;
  return (
    <a href={link.data.url} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- presigned links change every hour */}
      <img src={link.data.url} alt={`Proof of delivery: ${kind}`} className="size-28 rounded-md border border-wp-border object-cover" />
    </a>
  );
}
