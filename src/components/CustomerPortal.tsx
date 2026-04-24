import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import type { TFunction } from '../i18n'
import type { CreditPackPublic } from '../types'
import { Spinner } from './ui/Spinner'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import * as api from '../api/booking'
import { portalData, portalLoading, customerToken, customerInfo, setCustomerSession, clearCustomerSession } from '../state/booking'

interface CustomerPortalProps {
  venueSlug: string
  timezone: string
  /** Venue phone — used in the empty state of "Buy credits" so customers can reach out. */
  venuePhone?: string | null
  t: TFunction
  onBack: () => void
  onManageBooking: (cancelSecret: string) => void
}

const statusConfig: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: '#fef9c3', text: '#854d0e' },
  CONFIRMED: { bg: '#dcfce7', text: '#166534' },
  CHECKED_IN: { bg: '#dbeafe', text: '#1e40af' },
  COMPLETED: { bg: '#f3f4f6', text: '#1f2937' },
  CANCELLED: { bg: '#fee2e2', text: '#991b1b' },
  NO_SHOW: { bg: '#ffedd5', text: '#9a3412' },
}

const labelStyle: Record<string, string> = {
  display: 'block', fontSize: '13px', fontWeight: '500',
  color: 'var(--avq-fg, #111827)', marginBottom: '6px',
}

export function CustomerPortal({ venueSlug, timezone, venuePhone, t, onBack, onManageBooking }: CustomerPortalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [firstName, setFirstName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)

  // Credit packs state
  const [packs, setPacks] = useState<CreditPackPublic[]>([])
  const [packsLoading, setPacksLoading] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)

  const data = portalData.value
  const loading = portalLoading.value
  const token = customerToken.value

  // Auto-login from stored token
  useEffect(() => {
    if (token && !data) {
      loadPortal(token)
    }
  }, [])

  // Load available credit packs when portal is shown
  useEffect(() => {
    if (data) {
      loadPacks()
    }
  }, [data])

  async function loadPortal(tkn: string) {
    portalLoading.value = true
    try {
      const result = await api.getCustomerPortal(venueSlug, tkn)
      portalData.value = result
    } catch {
      // Token expired or invalid
      clearCustomerSession()
    } finally {
      portalLoading.value = false
    }
  }

  async function loadPacks() {
    setPacksLoading(true)
    try {
      const result = await api.getCreditPacks(venueSlug)
      setPacks(result)
    } catch {
      // Silently fail — packs section just won't show
    } finally {
      setPacksLoading(false)
    }
  }

  async function handleLogin(e: Event) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.customerLogin(venueSlug, { email: email.trim(), password: password.trim() })
      setCustomerSession(result.token, result.customer)
      await loadPortal(result.token)
    } catch (err: any) {
      setError(err.data?.message ?? t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRegister(e: Event) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.customerRegister(venueSlug, {
        email: email.trim(),
        password: password.trim(),
        phone: phone.trim() || undefined,
        firstName: firstName.trim() || undefined,
      })
      setCustomerSession(result.token, result.customer)
      await loadPortal(result.token)
    } catch (err: any) {
      setError(err.data?.message ?? t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  function handleLogout() {
    clearCustomerSession()
    setEmail('')
    setPassword('')
    setPhone('')
    setFirstName('')
    setError(null)
    setMode('login')
    setEditingProfile(false)
  }

  function startEditProfile() {
    const c = data?.customer
    setEditFirstName(c?.firstName || '')
    setEditLastName(c?.lastName || '')
    setEditPhone(c?.phone || '')
    setEditingProfile(true)
    setProfileSuccess(false)
  }

  async function handleSaveProfile() {
    if (!token) return
    setProfileSaving(true)
    setProfileSuccess(false)
    try {
      const updates: Record<string, string> = {}
      const c = data?.customer
      if (editFirstName.trim() !== (c?.firstName || '')) updates.firstName = editFirstName.trim()
      if (editLastName.trim() !== (c?.lastName || '')) updates.lastName = editLastName.trim()
      if (editPhone.trim() !== (c?.phone || '')) updates.phone = editPhone.trim()

      if (Object.keys(updates).length === 0) {
        setEditingProfile(false)
        return
      }

      const result = await api.updateCustomerProfile(venueSlug, token, updates)

      // Update local state
      if (customerInfo.value) {
        const updated = {
          ...customerInfo.value,
          firstName: result.customer.firstName,
          lastName: result.customer.lastName,
          phone: result.customer.phone,
        }
        setCustomerSession(token, updated)
      }
      // Reload portal data to refresh everything
      await loadPortal(token)
      setEditingProfile(false)
      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 3000)
    } catch (err: any) {
      setError(err.data?.message ?? t('errors.generic'))
    } finally {
      setProfileSaving(false)
    }
  }

  async function handleBuyPack(packId: string) {
    const cust = data?.customer
    if (!cust?.email && !cust?.phone) return
    setCheckoutLoading(packId)
    try {
      const result = await api.createPackCheckout(venueSlug, packId, {
        email: cust.email || undefined,
        phone: cust.phone || '',
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      })
      window.location.href = result.checkoutUrl
    } catch (err: any) {
      setError(err.data?.message ?? t('errors.generic'))
      setCheckoutLoading(null)
    }
  }

  // Loading state (auto-login)
  if (loading && !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0' }}>
        <Spinner size={28} />
      </div>
    )
  }

  // Auth forms (login / register)
  if (!data) {
    return (
      <div class="avq-animate-in">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%',
            background: 'var(--avq-muted, #f8f9fb)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--avq-accent, #6366f1)" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: '0 0 6px' }}>
            {mode === 'login' ? t('portal.login') : t('portal.register')}
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>
            {t('portal.subtitle')}
          </p>
        </div>

        <form onSubmit={mode === 'login' ? handleLogin : handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {mode === 'register' && (
            <div>
              <label style={labelStyle}>{t('form.name')}</label>
              <Input
                type="text"
                value={firstName}
                placeholder={t('form.namePlaceholder')}
                onInput={(e) => setFirstName((e.target as HTMLInputElement).value)}
              />
            </div>
          )}

          <div>
            <label style={labelStyle}>{t('portal.email')}</label>
            <Input
              type="email"
              value={email}
              placeholder={t('form.emailPlaceholder')}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
          </div>

          <div>
            <label style={labelStyle}>{t('portal.password')}</label>
            <Input
              type="password"
              value={password}
              placeholder={mode === 'register' ? t('portal.passwordMinChars') : '••••••'}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            />
          </div>

          {mode === 'register' && (
            <div>
              <label style={labelStyle}>
                {t('form.phone')} <span style={{ color: 'var(--avq-muted-fg, #6b7280)' }}>({t('portal.optional')})</span>
              </label>
              <Input
                type="tel"
                value={phone}
                placeholder={t('form.phonePlaceholder')}
                onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
              />
            </div>
          )}

          {error && (
            <p style={{ fontSize: '13px', color: '#ef4444', margin: 0 }}>{error}</p>
          )}

          <Button type="submit" fullWidth disabled={submitting || !email.trim() || !password.trim()}>
            {submitting ? <Spinner size={18} /> : mode === 'login' ? t('portal.loginButton') : t('portal.registerButton')}
          </Button>
        </form>

        {/* Toggle login/register */}
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>
            {mode === 'login' ? t('portal.noAccount') : t('portal.hasAccount')}
            {' '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--avq-accent, #6366f1)', fontWeight: '500',
                fontSize: '13px', textDecoration: 'underline', textUnderlineOffset: '2px',
              }}
            >
              {mode === 'login' ? t('portal.createAccount') : t('portal.loginButton')}
            </button>
          </p>
        </div>

        <div style={{ marginTop: '12px' }}>
          <Button variant="ghost" fullWidth onClick={onBack}>
            {t('portal.backToBooking')}
          </Button>
        </div>
      </div>
    )
  }

  // Portal dashboard (authenticated)
  const customer = data.customer
  const totalCredits = data.credits.purchases.reduce((sum, p) =>
    sum + p.itemBalances.reduce((s, b) => s + b.remainingQuantity, 0), 0,
  )
  const hasCredits = data.credits.purchases.length > 0 && totalCredits > 0
  const hasUpcoming = data.reservations.upcoming.length > 0
  const hasPast = data.reservations.past.length > 0

  return (
    <div class="avq-animate-in">
      {/* Header — Profile info + Edit/Logout */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: 0 }}>
            {customer
              ? `${t('portal.hello')}, ${customer.firstName || customer.email}`
              : t('portal.title')}
          </h2>
          {customer?.email && customer.firstName && (
            <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: '2px 0 0' }}>{customer.email}</p>
          )}
          {customer?.phone && (
            <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: '1px 0 0' }}>{customer.phone}</p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Edit profile button */}
          <button
            type="button"
            onClick={startEditProfile}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--avq-muted-fg, #6b7280)' }}
            title={t('portal.editProfile')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          {/* Logout button */}
          <button
            type="button"
            onClick={handleLogout}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--avq-muted-fg, #6b7280)' }}
            title={t('portal.logout')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Profile success toast */}
      {profileSuccess && (
        <div style={{
          padding: '10px 14px', borderRadius: '10px', marginBottom: '16px',
          background: '#dcfce7', color: '#166534', fontSize: '13px', fontWeight: '500',
        }}>
          {t('portal.profileUpdated')}
        </div>
      )}

      {/* Edit Profile Form */}
      {editingProfile && (
        <div style={{
          borderRadius: '12px', padding: '16px', marginBottom: '20px',
          border: '1px solid var(--avq-border, #e8eaed)', background: 'var(--avq-muted, #f8f9fb)',
        }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 12px' }}>
            {t('portal.editProfile')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={labelStyle}>{t('portal.firstName')}</label>
              <Input
                type="text"
                value={editFirstName}
                placeholder={t('portal.firstName')}
                onInput={(e) => setEditFirstName((e.target as HTMLInputElement).value)}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('portal.lastName')}</label>
              <Input
                type="text"
                value={editLastName}
                placeholder={t('portal.lastName')}
                onInput={(e) => setEditLastName((e.target as HTMLInputElement).value)}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('portal.phone')}</label>
              <Input
                type="tel"
                value={editPhone}
                placeholder="+52..."
                onInput={(e) => setEditPhone((e.target as HTMLInputElement).value)}
              />
            </div>
            {error && (
              <p style={{ fontSize: '13px', color: '#ef4444', margin: 0 }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="ghost" onClick={() => { setEditingProfile(false); setError(null) }}>
                {t('portal.cancel')}
              </Button>
              <Button onClick={handleSaveProfile} disabled={profileSaving}>
                {profileSaving ? <Spinner size={18} /> : t('portal.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Credits */}
      {hasCredits && (
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-accent, #6366f1)" stroke-width="2">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            {t('portal.credits')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.credits.purchases.map(purchase => (
              <div key={purchase.id} style={{ borderRadius: '12px', padding: '14px', border: '1px solid var(--avq-border, #e8eaed)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>{purchase.creditPack.name}</span>
                  {purchase.expiresAt && (
                    <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                      {t('portal.expires', { date: new Date(purchase.expiresAt).toLocaleDateString() })}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {purchase.itemBalances.map(balance => (
                    <div key={balance.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '13px', color: 'var(--avq-fg, #111827)' }}>{balance.product.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '48px', height: '6px', borderRadius: '3px', background: 'var(--avq-muted, #f8f9fb)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: '3px', background: 'var(--avq-accent, #6366f1)', width: `${(balance.remainingQuantity / balance.originalQuantity) * 100}%` }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--avq-accent, #6366f1)' }}>
                          {balance.remainingQuantity}/{balance.originalQuantity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasCredits && customer && (
        <div style={{ borderRadius: '12px', padding: '14px', background: 'var(--avq-muted, #f8f9fb)', border: '1px solid var(--avq-border, #e8eaed)', textAlign: 'center', marginBottom: '20px' }}>
          <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>{t('portal.noCredits')}</p>
        </div>
      )}

      {/* Buy Credits — header always visible; empty state when no packs.
          Cards no longer have outer border (they live inside a section already);
          rows are separated by a hairline divider for cleaner visual rhythm. */}
      {customer && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{
            fontSize: '11px', fontWeight: '600',
            color: 'var(--avq-muted-fg, #6b7280)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            margin: '0 0 12px',
          }}>
            {t('portal.buyCredits')}
          </h3>
          {packsLoading ? (
            <div style={{ padding: '24px', textAlign: 'center' }}>
              <Spinner size={18} />
            </div>
          ) : packs.length === 0 ? (
            <div style={{
              borderRadius: '12px', padding: '16px',
              background: 'var(--avq-muted, #f8f9fb)',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 10px' }}>
                {t('portal.noPacksAvailable')}
              </p>
              {venuePhone && (
                <a
                  href={`tel:${venuePhone}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    fontSize: '13px', fontWeight: '600',
                    color: 'var(--avq-accent, #6366f1)',
                    textDecoration: 'none',
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                  {t('portal.callVenue', { phone: venuePhone })}
                </a>
              )}
            </div>
          ) : (
          <div style={{
            display: 'flex', flexDirection: 'column',
            border: '1px solid var(--avq-border, #e8eaed)',
            borderRadius: '14px', overflow: 'hidden',
          }}>
            {packs.map((pack, idx) => (
              <div key={pack.id} style={{
                padding: '16px',
                borderTop: idx > 0 ? '1px solid var(--avq-border, #e8eaed)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pack.name}</div>
                    {pack.description && (
                      <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: '3px 0 0' }}>{pack.description}</p>
                    )}
                  </div>
                  <span style={{
                    fontSize: '17px', fontWeight: '700',
                    color: 'var(--avq-fg, #111827)',
                    whiteSpace: 'nowrap', flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    ${Number(pack.price).toFixed(0)}
                    <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)', fontWeight: '500', marginLeft: '4px' }}>{pack.currency}</span>
                  </span>
                </div>

                {/* Pack items as inline chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                  {pack.items.map(item => (
                    <span key={item.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      padding: '3px 9px', borderRadius: '999px',
                      background: 'var(--avq-muted, #f8f9fb)',
                      fontSize: '12px', color: 'var(--avq-fg, #111827)',
                    }}>
                      <strong style={{ fontWeight: '700', color: 'var(--avq-accent, #6366f1)' }}>{item.quantity}×</strong>
                      <span>{item.product.name}</span>
                    </span>
                  ))}
                </div>

                {/* Validity + Buy */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                    {pack.validityDays
                      ? t('portal.packValidity', { days: String(pack.validityDays) })
                      : t('portal.packNoExpiry')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleBuyPack(pack.id)}
                    disabled={!!checkoutLoading}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: '7px 18px', borderRadius: '999px', fontSize: '13px', fontWeight: '600',
                      background: 'var(--avq-accent, #6366f1)', color: '#fff',
                      border: 'none', cursor: checkoutLoading ? 'not-allowed' : 'pointer',
                      opacity: checkoutLoading ? 0.6 : 1,
                      transition: 'opacity 0.15s var(--avq-ease)',
                    }}
                  >
                    {checkoutLoading === pack.id ? <Spinner size={14} /> : t('portal.buyPack')}
                  </button>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {/* Upcoming */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{
          fontSize: '11px', fontWeight: '600',
          color: 'var(--avq-muted-fg, #6b7280)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          margin: '0 0 12px',
        }}>
          {t('portal.upcoming')}
        </h3>
        {hasUpcoming ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.reservations.upcoming.map(res => {
              const start = new Date(res.startsAt)
              const end = new Date(res.endsAt)
              const sc = statusConfig[res.status] ?? statusConfig.CONFIRMED
              return (
                <div key={res.confirmationCode} style={{ borderRadius: '12px', padding: '14px', border: '1px solid var(--avq-border, #e8eaed)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '600', background: sc.bg, color: sc.text, padding: '2px 8px', borderRadius: '6px' }}>
                      {t(`status.${res.status}`)}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)', fontWeight: '500' }}>{res.confirmationCode}</span>
                  </div>
                  {res.product && (
                    <p style={{ fontSize: '14px', fontWeight: '500', color: 'var(--avq-fg, #111827)', margin: '0 0 4px' }}>{res.product.name}</p>
                  )}
                  <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 10px' }}>
                    {start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone })}
                    {' '}
                    {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone })}
                    {' - '}
                    {end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone })}
                  </p>
                  <button
                    type="button"
                    onClick={() => onManageBooking(res.cancelSecret)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '500', color: 'var(--avq-accent, #6366f1)', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                  >
                    {t('portal.manage')}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ borderRadius: '12px', padding: '14px', background: 'var(--avq-muted, #f8f9fb)', border: '1px solid var(--avq-border, #e8eaed)', textAlign: 'center' }}>
            <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>{t('portal.noUpcoming')}</p>
          </div>
        )}
      </div>

      {/* Past */}
      {hasPast && (
        <details style={{ marginBottom: '24px' }}>
          <summary style={{
            fontSize: '11px', fontWeight: '600',
            color: 'var(--avq-muted-fg, #6b7280)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            cursor: 'pointer',
            marginBottom: '12px',
          }}>
            {t('portal.pastReservations')}
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {data.reservations.past.map(res => {
              const start = new Date(res.startsAt)
              const sc = statusConfig[res.status] ?? statusConfig.COMPLETED
              return (
                <div key={res.confirmationCode} style={{ borderRadius: '10px', padding: '10px 14px', border: '1px solid var(--avq-border, #e8eaed)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: 0.8 }}>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)', margin: '0 0 2px' }}>{res.product?.name ?? res.guestName}</p>
                    <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>{start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: timezone })}</p>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: '600', background: sc.bg, color: sc.text, padding: '2px 8px', borderRadius: '6px' }}>{t(`status.${res.status}`)}</span>
                </div>
              )
            })}
          </div>
        </details>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Button variant="primary" fullWidth onClick={onBack}>{t('portal.bookNow')}</Button>
        <Button variant="ghost" fullWidth onClick={handleLogout}>{t('portal.logout')}</Button>
      </div>
    </div>
  )
}
