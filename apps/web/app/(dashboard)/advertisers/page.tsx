import Link from "next/link";
import { DeleteAdvertiserButton } from "@/components/delete-advertiser-button";
import { Icons } from "@/components/icons";
import { PendingButton } from "@/components/pending-button";
import { formatCountries, formatDateTime, nextScheduledScanTime, transparencyAdvertiserUrl } from "@/components/display";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getAdvertisers, getAppSettings } from "@/lib/data";
import { addAdvertiserAction, queueScanAction, runFullScanAction } from "../actions";

export default async function AdvertisersPage() {
  const [advertisers, settings] = await Promise.all([getAdvertisers(), getAppSettings()]);

  return (
    <>
      <PageHeader title="Рекламодатели" subtitle="Добавление рекламодателей и запуск проверок" />

      <section className="panel" style={{ marginBottom: 16 }}>
        <form className="form-row" action={addAdvertiserAction}>
          <input className="input" name="input" placeholder="ID рекламодателя или ссылка Transparency Center" required />
          <input className="input" name="name" placeholder="Название" />
          <input className="input" name="countries" placeholder="GB, BE, FR, DE" />
          <select className="select" name="scanMode" defaultValue="FULL">
            <option value="FULL">Полный сбор</option>
            <option value="FAST">Быстрый сбор</option>
            <option value="CAUTIOUS">Осторожный сбор</option>
          </select>
          <PendingButton className="button primary" pendingText="Добавляем" type="submit"><Icons.Plus size={16} />Добавить</PendingButton>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Список рекламодателей</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>№</th>
              <th>Рекламодатель</th>
              <th>Страны</th>
              <th>Креативы</th>
              <th>Последний скан</th>
              <th>Следующий</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {advertisers.map((advertiser, index) => {
              const activeJob = advertiser.scanJobs[0] && ["QUEUED", "RUNNING"].includes(advertiser.scanJobs[0].status)
                ? advertiser.scanJobs[0]
                : null;

              return (
                <tr key={advertiser.id}>
                  <td>{index + 1}</td>
                  <td>
                    <Link href={`/advertisers/${advertiser.id}`}><strong>{advertiser.name ?? advertiser.googleAdvertiserId}</strong></Link>
                    <div className="muted">{advertiser.googleAdvertiserId}</div>
                  </td>
                  <td>{formatCountries(advertiser.selectedCountries)}</td>
                  <td>{advertiser.totalCreatives}</td>
                  <td>{formatDateTime(advertiser.lastScanAt)}</td>
                  <td>{advertiser.dailyScanEnabled ? formatDateTime(advertiser.nextScanAt ?? nextScheduledScanTime(new Date(), settings)) : "выключено"}</td>
                  <td><StatusBadge status={activeJob?.status ?? advertiser.lastScanStatus} /></td>
                  <td className="actions-cell">
                    <Link className="icon-button" href={`/advertisers/${advertiser.id}`} title="Открыть карточку"><Icons.Eye size={16} /></Link>
                    <a className="icon-button" href={transparencyAdvertiserUrl(advertiser.googleAdvertiserId)} target="_blank" title="Открыть в Transparency Center"><Icons.ExternalLink size={16} /></a>
                    <Link className="icon-button" href={`/export?advertiserId=${advertiser.id}`} title="Экспорт рекламодателя"><Icons.Download size={16} /></Link>
                    <DeleteAdvertiserButton advertiserId={advertiser.id} advertiserName={advertiser.name ?? advertiser.googleAdvertiserId} />
                    <form action={queueScanAction} className="inline-form">
                      <input name="advertiserId" type="hidden" value={advertiser.id} />
                      <input name="countries" type="hidden" value={advertiser.selectedCountries.join(",")} />
                      <PendingButton className="button" disabled={Boolean(activeJob)} pendingText="В очередь" type="submit">
                        <Icons.TimerReset size={16} />{activeJob ? "Уже в очереди" : "Проверить"}
                      </PendingButton>
                    </form>
                    <form action={runFullScanAction} className="inline-form">
                      <input name="advertiserId" type="hidden" value={advertiser.id} />
                      <input name="countries" type="hidden" value={advertiser.selectedCountries.join(",")} />
                      <PendingButton className="button" disabled={Boolean(activeJob)} pendingText="Ставим в очередь" type="submit">
                        <Icons.Search size={16} />{activeJob ? "Уже в очереди" : "Полный сбор"}
                      </PendingButton>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
