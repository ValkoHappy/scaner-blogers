import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatAssetKind, formatDate, formatStoreLabel, transparencyCreativeUrl } from "@/components/display";
import { Icons } from "@/components/icons";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getCreative } from "@/lib/data";

export default async function CreativeDetailPage({ params }: { params: Promise<{ creativeId: string }> }) {
  const { creativeId } = await params;
  const creative = await getCreative(creativeId);
  if (!creative) notFound();

  return (
    <>
      <PageHeader title={creative.creativeId} subtitle={creative.app?.name ?? creative.advertiser?.name ?? "Детали креатива"}>
        <StatusBadge status={creative.status} />
        {creative.advertiser ? <a className="button" href={transparencyCreativeUrl(creative.advertiser.googleAdvertiserId, creative.creativeId)} target="_blank"><Icons.ExternalLink size={16} />Transparency</a> : null}
        {creative.previewUrl ? <Link className="button" href={`/preview/${creative.creativeId}`}><Icons.AppWindow size={16} />Предпросмотр</Link> : null}
      </PageHeader>

      <section className="grid three-col" style={{ marginBottom: 16 }}>
        <Info label="Приложение" value={creative.app?.appId ?? "Неизвестно"} />
        <Info label="Публичен" value={`${creative.publicDays ?? "—"} дней`} />
        <Info label="Показы" value={formatRange(creative.impressionsMin, creative.impressionsMax)} />
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          <h2 className="panel-title">Обзор</h2>
        </div>
        <div className="details-grid">
          <InfoLine label="Рекламодатель" value={creative.advertiser ? <Link href={`/advertisers/${creative.advertiser.id}`}>{creative.advertiser.name ?? creative.advertiser.googleAdvertiserId}</Link> : "—"} />
          <InfoLine label="Магазин" value={creative.app?.storeUrl ? <a href={creative.app.storeUrl} target="_blank">{formatStoreLabel(creative.app.store)}</a> : formatStoreLabel(creative.app?.store)} />
          <InfoLine label="Первый показ" value={formatDate(creative.firstShownAt)} />
          <InfoLine label="Последний показ" value={formatDate(creative.lastShownAt)} />
          <InfoLine label="Разработчик" value={creative.app?.developer ?? "—"} />
          <InfoLine label="Категория" value={creative.app?.category ?? "—"} />
        </div>
      </section>

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">География</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Страна</th>
                <th>Показы</th>
                <th>Первый</th>
                <th>Последний</th>
              </tr>
            </thead>
            <tbody>
              {creative.countries.map((country) => (
                <tr key={country.id}>
                  <td>{country.countryCode ?? country.googleGeoId} <span className="muted">{country.countryName}</span></td>
                  <td>{formatRange(country.impressionsMin, country.impressionsMax)}</td>
                  <td>{country.firstShownDate ?? "—"}</td>
                  <td>{country.lastShownDate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Ассеты</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Тип</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {creative.assets.map((asset) => (
                <tr key={asset.id}>
                  <td>{formatAssetKind(asset.kind)}</td>
                  <td><a className="muted" href={asset.url} target="_blank">{asset.url.slice(0, 80)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="panel source-details" style={{ marginTop: 16 }}>
        <summary className="panel-title">Данные источника</summary>
        <pre className="raw-box">{JSON.stringify(creative.rawSnapshots ?? [], null, 2)}</pre>
      </details>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 18 }}>{value}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
}

function formatRange(min?: number | null, max?: number | null) {
  if (min && max) return `${min.toLocaleString("en-US")} - ${max.toLocaleString("en-US")}`;
  if (max) return `до ${max.toLocaleString("en-US")}`;
  return "—";
}
