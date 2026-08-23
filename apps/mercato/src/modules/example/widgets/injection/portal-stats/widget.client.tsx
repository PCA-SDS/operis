"use client"

const STATS = [
  { label: 'Orders', value: '12', trend: '+3 this month', color: 'text-status-success-icon dark:text-status-success-icon' },
  { label: 'Pending', value: '2', trend: 'Awaiting shipment', color: 'text-status-warning-icon dark:text-status-warning-icon' },
  { label: 'Invoices', value: '8', trend: '3 unpaid', color: 'text-status-info-icon dark:text-status-info-icon' },
  { label: 'Quotes', value: '4', trend: '1 expiring soon', color: 'text-status-pink-icon' },
]

export default function PortalStatsWidget() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {STATS.map((stat) => (
        <div key={stat.label}>
          <p className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/60">
            {stat.label}
          </p>
          <p className={`mt-0.5 text-2xl font-bold tracking-tight ${stat.color}`}>
            {stat.value}
          </p>
          <p className="mt-0.5 text-overline text-muted-foreground">{stat.trend}</p>
        </div>
      ))}
    </div>
  )
}
