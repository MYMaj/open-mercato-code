import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesOrder } from '../../../../data/entities'
import { resolveWidgetScope, resolveDateRange, type WidgetScopeContext, type DatePeriodOption } from '../utils'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { FilterQuery } from '@mikro-orm/core'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  datePeriod: z.enum(['last24h', 'last7d', 'last30d', 'custom']).default('last24h'),
  customFrom: z.string().optional(),
  customTo: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'sales.widgets.new-orders'] },
}

type WidgetContext = WidgetScopeContext & {
  limit: number
  datePeriod: DatePeriodOption
  customFrom?: string
  customTo?: string
}

async function resolveContext(req: Request, translate: (key: string, fallback?: string) => string): Promise<WidgetContext> {
  const url = new URL(req.url)
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    rawQuery[key] = value
  }
  const parsed = querySchema.safeParse(rawQuery)
  if (!parsed.success) {
    throw new CrudHttpError(400, { error: translate('sales.errors.invalid_query', 'Invalid query parameters') })
  }

  const { container, em, tenantId, organizationIds } = await resolveWidgetScope(req, translate, {
    tenantId: parsed.data.tenantId ?? null,
    organizationId: parsed.data.organizationId ?? null,
  })

  return {
    container,
    em,
    tenantId,
    organizationIds,
    limit: parsed.data.limit,
    datePeriod: parsed.data.datePeriod as DatePeriodOption,
    customFrom: parsed.data.customFrom,
    customTo: parsed.data.customTo,
  }
}

function extractCustomerName(customerSnapshot: Record<string, unknown> | null | undefined): string | null {
  if (!customerSnapshot) return null
  if (typeof customerSnapshot.displayName === 'string') return customerSnapshot.displayName
  if (typeof customerSnapshot.name === 'string') return customerSnapshot.name
  if (typeof customerSnapshot.companyName === 'string') return customerSnapshot.companyName
  const firstName = typeof customerSnapshot.firstName === 'string' ? customerSnapshot.firstName : ''
  const lastName = typeof customerSnapshot.lastName === 'string' ? customerSnapshot.lastName : ''
  const fullName = `${firstName} ${lastName}`.trim()
  return fullName || null
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds, limit, datePeriod, customFrom, customTo } = await resolveContext(req, translate)

    const { from, to } = resolveDateRange(datePeriod, customFrom, customTo)

    const where: FilterQuery<SalesOrder> = {
      tenantId,
      deletedAt: null,
      createdAt: { $gte: from, $lte: to },
    }
    if (Array.isArray(organizationIds)) {
      where.organizationId =
        organizationIds.length === 1 ? organizationIds[0] : { $in: Array.from(new Set(organizationIds)) }
    }

    const [entities, total] = await Promise.all([
      em.find(SalesOrder, where, {
        limit,
        orderBy: { createdAt: 'desc' as const },
      }),
      em.count(SalesOrder, where),
    ])

    const items = entities.map((entity) => ({
      id: entity.id,
      orderNumber: entity.orderNumber,
      status: entity.status ?? null,
      fulfillmentStatus: entity.fulfillmentStatus ?? null,
      paymentStatus: entity.paymentStatus ?? null,
      customerName: extractCustomerName(entity.customerSnapshot),
      customerEntityId: entity.customerEntityId ?? null,
      netAmount: entity.grandTotalNetAmount,
      grossAmount: entity.grandTotalGrossAmount,
      currencyCode: entity.currencyCode ?? null,
      createdAt: entity.createdAt.toISOString(),
    }))

    return NextResponse.json({
      items,
      total,
      dateRange: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('Failed to fetch new orders widget data', err)
    return NextResponse.json({ error: translate('sales.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const orderItemSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: z.string().nullable(),
  fulfillmentStatus: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEntityId: z.string().uuid().nullable(),
  netAmount: z.string(),
  grossAmount: z.string(),
  currencyCode: z.string().nullable(),
  createdAt: z.string(),
})

const responseSchema = z.object({
  items: z.array(orderItemSchema),
  total: z.number(),
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'New orders widget data',
  methods: {
    GET: {
      summary: 'Fetch recently created sales orders for dashboard widget',
      query: querySchema,
      responses: [
        { status: 200, schema: responseSchema },
      ],
      errors: [
        { status: 400, schema: z.object({ error: z.string() }) },
        { status: 401, schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
