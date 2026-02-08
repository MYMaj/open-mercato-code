"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DEFAULT_SETTINGS,
  hydrateSalesNewOrdersSettings,
  type SalesNewOrdersSettings,
  type DatePeriodOption,
} from './config'

type OrderItem = {
  id: string
  orderNumber: string
  status: string | null
  fulfillmentStatus: string | null
  paymentStatus: string | null
  customerName: string | null
  grossAmount: string
  currencyCode: string | null
  createdAt: string
}

type WidgetResponse = {
  items: OrderItem[]
  total: number
  dateRange: {
    from: string
    to: string
  }
}

async function loadNewOrders(settings: SalesNewOrdersSettings): Promise<WidgetResponse> {
  const params = new URLSearchParams({
    limit: String(settings.pageSize),
    datePeriod: settings.datePeriod,
  })
  if (settings.datePeriod === 'custom') {
    if (settings.customFrom) params.set('customFrom', settings.customFrom)
    if (settings.customTo) params.set('customTo', settings.customTo)
  }

  const call = await apiCall<WidgetResponse | { error?: string }>(
    `/api/sales/dashboard/widgets/new-orders?${params.toString()}`,
  )
  if (!call.ok) {
    const message =
      typeof (call.result as Record<string, unknown> | null)?.error === 'string'
        ? ((call.result as Record<string, unknown>).error as string)
        : `Request failed with status ${call.status}`
    throw new Error(message)
  }
  const payload = call.result as WidgetResponse
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    total: typeof payload?.total === 'number' ? payload.total : 0,
    dateRange: payload?.dateRange ?? { from: '', to: '' },
  }
}

function formatCurrency(amount: string, currency: string | null): string {
  const num = parseFloat(amount)
  if (Number.isNaN(num)) return amount
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency ?? 'USD',
    }).format(num)
  } catch {
    return `${amount} ${currency ?? ''}`
  }
}

function formatDate(value: string | null, locale?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale ?? undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const DATE_PERIOD_OPTIONS: { value: DatePeriodOption; labelKey: string }[] = [
  { value: 'last24h', labelKey: 'sales.widgets.newOrders.periods.last24h' },
  { value: 'last7d', labelKey: 'sales.widgets.newOrders.periods.last7d' },
  { value: 'last30d', labelKey: 'sales.widgets.newOrders.periods.last30d' },
  { value: 'custom', labelKey: 'sales.widgets.newOrders.periods.custom' },
]

const SalesNewOrdersWidget: React.FC<DashboardWidgetComponentProps<SalesNewOrdersSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSalesNewOrdersSettings(settings), [settings])
  const [data, setData] = React.useState<WidgetResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [locale, setLocale] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setLocale(navigator.language)
    }
  }, [])

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await loadNewOrders(hydrated)
      setData(result)
    } catch (err) {
      console.error('Failed to load new orders widget data', err)
      setError(t('sales.widgets.newOrders.error'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor="sales-new-orders-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('sales.widgets.newOrders.settings.pageSize')}
          </label>
          <input
            id="sales-new-orders-page-size"
            type="number"
            min={1}
            max={20}
            className="w-24 rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.pageSize}
            onChange={(event) => {
              const next = Number(event.target.value)
              onSettingsChange({ ...hydrated, pageSize: Number.isFinite(next) ? next : hydrated.pageSize })
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="sales-new-orders-date-period" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('sales.widgets.newOrders.settings.datePeriod')}
          </label>
          <select
            id="sales-new-orders-date-period"
            className="w-full rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.datePeriod}
            onChange={(event) => {
              const value = event.target.value as DatePeriodOption
              onSettingsChange({ ...hydrated, datePeriod: value })
            }}
          >
            {DATE_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
        {hydrated.datePeriod === 'custom' && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="sales-new-orders-custom-from" className="text-xs font-semibold uppercase text-muted-foreground">
                {t('sales.widgets.newOrders.settings.customFrom')}
              </label>
              <input
                id="sales-new-orders-custom-from"
                type="date"
                className="w-full rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={hydrated.customFrom?.split('T')[0] ?? ''}
                onChange={(event) => {
                  onSettingsChange({ ...hydrated, customFrom: event.target.value ? new Date(event.target.value).toISOString() : undefined })
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="sales-new-orders-custom-to" className="text-xs font-semibold uppercase text-muted-foreground">
                {t('sales.widgets.newOrders.settings.customTo')}
              </label>
              <input
                id="sales-new-orders-custom-to"
                type="date"
                className="w-full rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={hydrated.customTo?.split('T')[0] ?? ''}
                onChange={(event) => {
                  onSettingsChange({ ...hydrated, customTo: event.target.value ? new Date(event.target.value).toISOString() : undefined })
                }}
              />
            </div>
          </>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-5 w-5 text-muted-foreground" />
        <span className="ml-2 text-muted-foreground text-sm">{t('sales.widgets.newOrders.loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-4 text-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        {t('sales.widgets.newOrders.empty')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {data.items.map((item) => {
        const href = `/backend/sales/orders/${encodeURIComponent(item.id)}`
        return (
          <Link
            key={item.id}
            href={href}
            className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-muted/50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">
                  #{item.orderNumber}
                </span>
                {item.status && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {item.status}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {item.customerName ?? t('sales.widgets.newOrders.unknownCustomer')}
                <span className="mx-1">•</span>
                {formatDate(item.createdAt, locale)}
              </div>
            </div>
            <div className="ml-4 text-right shrink-0">
              <div className="font-semibold">
                {formatCurrency(item.grossAmount, item.currencyCode)}
              </div>
            </div>
          </Link>
        )
      })}
      {data.total > data.items.length && (
        <div className="text-center text-xs text-muted-foreground pt-2">
          {t('sales.widgets.newOrders.showingOf', { shown: data.items.length, total: data.total })}
        </div>
      )}
    </div>
  )
}

export default SalesNewOrdersWidget
