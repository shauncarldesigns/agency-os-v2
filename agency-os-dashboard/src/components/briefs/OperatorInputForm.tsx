import { useState, useEffect } from 'react';
import type {
  Project, Lead, ShowToast, Brief, BrandAttributeCategory,
} from '../../lib/types';
import { Modal, ModalHeader } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { api, ApiError } from '../../lib/api';

/**
 * The single project-editor modal.
 *
 * Two modes:
 *  - First-time: master brief doesn't exist yet → title says "Generate
 *    Master Brief", footer offers a single ✦ Save & Generate button.
 *  - Existing: master exists → title says "Edit Project", footer offers
 *    Save (project fields only) + ✦ Save & Regenerate Brief (project + fresh
 *    Claude regenerate).
 *
 * Holds tier picker, business details, brand, services/areas chips,
 * testimonials, and a Danger Zone delete — i.e. everything the operator
 * can do to a project lives here. Replaces the standalone EditProjectModal.
 */

interface OperatorInputFormProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  lead: Lead | null;
  /** True when this project already has a master brief — drives title +
   *  footer copy + the regen-vs-create path inside handleSubmit. */
  hasMaster: boolean;
  showToast: ShowToast;
  /** Fired after a brief is (re)generated. */
  onBriefGenerated: (brief: Brief) => void;
  /** Fired after Save (project fields only, no brief regen). */
  onProjectSaved?: (project: Project) => void;
  /** Fired after the project is deleted. Parent should bounce out of the
   *  Brief Studio detail view since the project is gone. */
  onDeleted?: (projectId: number) => void;
}

interface DraftTestimonial {
  id?: number;                   // existing testimonial id
  author_name: string;
  author_location: string;
  quote: string;
  rating: number | null;
  source: 'google' | 'operator' | 'website' | 'other';
  is_featured: boolean;
  is_new: boolean;
}

interface DraftBrandAttr {
  category: BrandAttributeCategory;
  value: string;
}

type Tier = 1 | 2 | 3;

const TIER_OPTIONS: ReadonlyArray<{
  tier: Tier;
  label: string;
  price: string;
  blurb: string;
}> = [
  { tier: 1, label: 'Tier 1 · Foundation', price: '$800 one-time', blurb: 'No ongoing service.' },
  { tier: 2, label: 'Tier 2 · Managed', price: '$79/mo', blurb: 'Hosting + edits.' },
  { tier: 3, label: 'Tier 3 · SEO Program', price: '$499/mo', blurb: 'Brief Studio + monthly SEO pages.' },
];

export function OperatorInputForm({
  open, onClose, project, lead, hasMaster, showToast,
  onBriefGenerated, onProjectSaved, onDeleted,
}: OperatorInputFormProps) {
  const [tier, setTier] = useState<Tier>((project.tier ?? 3) as Tier);
  const [businessName, setBusinessName] = useState(project.business_name);
  const [city, setCity] = useState(project.city ?? '');
  const [stateCode, setStateCode] = useState(project.state ?? 'WI');
  const [phone, setPhone] = useState(project.phone ?? '');
  const [email, setEmail] = useState(project.email ?? '');
  const [foundedYear, setFoundedYear] = useState<string>(project.founded_year?.toString() ?? '');
  const [ownerName, setOwnerName] = useState(project.owner_name ?? '');
  const [ownerCredentials, setOwnerCredentials] = useState(project.owner_credentials ?? '');
  const [tagline, setTagline] = useState(project.tagline ?? '');
  const [primaryColor, setPrimaryColor] = useState(project.primary_color ?? '#1B3A5C');
  const [accentColor, setAccentColor] = useState(project.accent_color ?? '#E8A33D');
  const [services, setServices] = useState<string[]>(safeParseArr(project.services, lead?.extracted_services));
  const [serviceAreas, setServiceAreas] = useState<string[]>(safeParseArr(project.service_areas, lead?.extracted_service_areas));
  const [newService, setNewService] = useState('');
  const [newArea, setNewArea] = useState('');
  const [testimonials, setTestimonials] = useState<DraftTestimonial[]>([]);
  const [extraAttrs, setExtraAttrs] = useState<DraftBrandAttr[]>([]);
  const [saving, setSaving] = useState<'idle' | 'save' | 'save+regen' | 'deleting'>('idle');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<'idle' | 'running' | 'done' | 'skipped' | 'failed'>('idle');
  const [scrapeMessage, setScrapeMessage] = useState<string>('');

  // Reseed state when the modal reopens or the project changes.
  useEffect(() => {
    if (!open) return;
    setTier((project.tier ?? 3) as Tier);
    setBusinessName(project.business_name);
    setCity(project.city ?? '');
    setStateCode(project.state ?? 'WI');
    setPhone(project.phone ?? '');
    setEmail(project.email ?? '');
    setFoundedYear(project.founded_year?.toString() ?? '');
    setOwnerName(project.owner_name ?? '');
    setOwnerCredentials(project.owner_credentials ?? '');
    setTagline(project.tagline ?? '');
    setPrimaryColor(project.primary_color ?? '#1B3A5C');
    setAccentColor(project.accent_color ?? '#E8A33D');
    setServices(safeParseArr(project.services, lead?.extracted_services));
    setServiceAreas(safeParseArr(project.service_areas, lead?.extracted_service_areas));
    setExtraAttrs([]);
    setConfirmingDelete(false);
    void seedTestimonials();
    void maybeRunScrape();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.id]);

  async function maybeRunScrape() {
    if (project.scrape_completed_at) {
      setScrapeStatus('skipped');
      setScrapeMessage('Website already scraped — re-run from project settings if needed.');
      return;
    }
    if (!lead?.website) {
      setScrapeStatus('skipped');
      setScrapeMessage('No website on file — skipping scrape.');
      return;
    }
    setScrapeStatus('running');
    setScrapeMessage(`Scraping ${lead.website}…`);
    try {
      const res = await api.scrape.run(project.id);
      if (res.ok) {
        setScrapeStatus('done');
        setScrapeMessage(`Scraped ${res.pages_fetched} page(s) — ${res.brand_attributes_inserted} brand attribute(s) extracted.`);
      } else {
        setScrapeStatus('failed');
        setScrapeMessage(`Scrape skipped: ${res.reason ?? 'unknown'}.`);
      }
    } catch (err) {
      setScrapeStatus('failed');
      setScrapeMessage(`Scrape failed: ${err instanceof ApiError ? err.message : (err as Error).message}`);
    }
  }

  async function seedTestimonials() {
    const drafts: DraftTestimonial[] = [];
    try {
      const existing = await api.testimonials.list(project.id);
      for (const t of existing.testimonials) {
        drafts.push({
          id: t.id,
          author_name: t.author_name,
          author_location: t.author_location ?? '',
          quote: t.quote,
          rating: t.rating,
          source: (t.source ?? 'google') as DraftTestimonial['source'],
          is_featured: t.is_featured === 1,
          is_new: false,
        });
      }
    } catch {
      // ignore — fresh project may have none
    }
    if (lead?.google_reviews) {
      try {
        const reviews = JSON.parse(lead.google_reviews) as Array<{ author: string; rating: number; text: string }>;
        for (const r of reviews) {
          const exists = drafts.some((d) => d.author_name === r.author && d.quote === r.text);
          if (!exists) {
            drafts.push({
              author_name: r.author,
              author_location: lead.city ?? '',
              quote: r.text,
              rating: r.rating,
              source: 'google',
              is_featured: false,
              is_new: true,
            });
          }
        }
      } catch {
        // ignore malformed
      }
    }
    setTestimonials(drafts);
  }

  function addChip(setter: (v: string) => void, list: string[], onSet: (next: string[]) => void, current: string) {
    const v = current.trim();
    if (!v) return;
    if (!list.includes(v)) onSet([...list, v]);
    setter('');
  }

  function removeChip(list: string[], onSet: (next: string[]) => void, idx: number) {
    onSet(list.filter((_, i) => i !== idx));
  }

  function toggleTestimonial(idx: number, patch: Partial<DraftTestimonial>) {
    setTestimonials((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }

  function setAllFeatured(featured: boolean) {
    setTestimonials((prev) => prev.map((t) => ({ ...t, is_featured: featured })));
  }

  function addBlankTestimonial() {
    setTestimonials((prev) => [
      ...prev,
      { author_name: '', author_location: '', quote: '', rating: 5, source: 'operator', is_featured: true, is_new: true },
    ]);
  }

  function removeTestimonial(idx: number) {
    setTestimonials((prev) => prev.filter((_, i) => i !== idx));
  }

  function addExtraAttr() {
    setExtraAttrs((prev) => [...prev, { category: 'certification', value: '' }]);
  }

  function updateExtraAttr(idx: number, patch: Partial<DraftBrandAttr>) {
    setExtraAttrs((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }

  function removeExtraAttr(idx: number) {
    setExtraAttrs((prev) => prev.filter((_, i) => i !== idx));
  }

  /**
   * Push the form state to the backend. Two callsites:
   *  - handleSave() → just persist, no brief work
   *  - handleSaveAndRegen() → persist, then create/regen the master brief
   *
   * Returns the updated project so callers can hand it back to their parents.
   */
  async function persistAll(): Promise<Project | null> {
    if (!businessName.trim()) {
      showToast('Business name required', 'error');
      return null;
    }
    const yearNum = foundedYear.trim() ? Number(foundedYear.trim()) : null;
    const res = await api.projects.update(project.id, {
      tier,
      business_name: businessName.trim(),
      city: city.trim() || null,
      state: stateCode.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      founded_year: yearNum && !Number.isNaN(yearNum) ? yearNum : null,
      owner_name: ownerName.trim() || null,
      owner_credentials: ownerCredentials.trim() || null,
      tagline: tagline.trim() || null,
      primary_color: primaryColor,
      accent_color: accentColor,
      services,
      service_areas: serviceAreas,
    });

    for (const t of testimonials) {
      if (!t.quote.trim() || !t.author_name.trim()) continue;
      if (t.is_new) {
        await api.testimonials.create(project.id, {
          authorName: t.author_name.trim(),
          authorLocation: t.author_location.trim() || undefined,
          quote: t.quote.trim(),
          rating: t.rating ?? undefined,
          source: t.source,
          isFeatured: t.is_featured,
        });
      } else if (t.id != null) {
        await api.testimonials.update(t.id, {
          authorName: t.author_name.trim(),
          authorLocation: t.author_location.trim() || null,
          quote: t.quote.trim(),
          rating: t.rating,
          source: t.source,
          isFeatured: t.is_featured,
        });
      }
    }

    for (const a of extraAttrs) {
      if (!a.value.trim()) continue;
      await api.brandAttributes.create(project.id, {
        category: a.category,
        value: a.value.trim(),
        source: 'operator',
      });
    }

    return res.project;
  }

  async function handleSave() {
    setSaving('save');
    try {
      const updated = await persistAll();
      if (!updated) return;
      showToast('Project saved', 'success');
      onProjectSaved?.(updated);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Save failed: ${msg}`, 'error');
    } finally {
      setSaving('idle');
    }
  }

  async function handleSaveAndRegen() {
    setSaving('save+regen');
    try {
      const updated = await persistAll();
      if (!updated) return;
      const brief = hasMaster
        ? await api.briefs.regenerateMaster(project.id)
        : await api.briefs.master(project.id);
      showToast(hasMaster ? `Master brief regenerated (v${brief.version})` : 'Master brief generated', 'success');
      onProjectSaved?.(updated);
      onBriefGenerated(brief);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`${hasMaster ? 'Regenerate' : 'Generate'} failed: ${msg}`, 'error');
    } finally {
      setSaving('idle');
    }
  }

  async function handleDelete() {
    setSaving('deleting');
    try {
      await api.projects.delete(project.id);
      showToast(`${project.business_name} deleted — lead returned to Pipeline as 'qualified'`, 'success');
      onDeleted?.(project.id);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Delete failed: ${msg}`, 'error');
      setSaving('idle');
    }
  }

  const busy = saving !== 'idle';
  const allFeatured = testimonials.length > 0 && testimonials.every((t) => t.is_featured);
  const tierChanged = tier !== project.tier;
  const demotingFromT3 = project.tier === 3 && tier !== 3;
  const promotingToT3 = project.tier !== 3 && tier === 3;

  const title = hasMaster
    ? `Edit Project — ${project.business_name}`
    : `Master Brief — ${project.business_name}`;
  const regenLabel = hasMaster ? '✦ Save & Regenerate Brief' : '✦ Save & Generate Brief';

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} width={780}>
      <ModalHeader title={title} onClose={busy ? () => undefined : onClose} />

      <div style={{ padding: 18, maxHeight: '70vh', overflowY: 'auto' }}>
        {scrapeStatus !== 'idle' && (
          <div style={{
            background: scrapeStatus === 'done' ? 'rgba(82, 220, 134, 0.08)'
              : scrapeStatus === 'failed' ? 'rgba(255, 99, 99, 0.08)'
              : 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r)',
            padding: '8px 12px',
            marginBottom: 14,
            fontSize: '0.7rem',
            color: 'var(--text2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            {scrapeStatus === 'running' && <Spinner />}
            <span>{scrapeMessage}</span>
          </div>
        )}

        <SectionTitle>Tier</SectionTitle>
        <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          {TIER_OPTIONS.map((opt) => {
            const selected = tier === opt.tier;
            return (
              <button
                key={opt.tier}
                type="button"
                onClick={() => setTier(opt.tier)}
                disabled={busy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '9px 12px',
                  background: selected ? 'var(--surface2)' : 'var(--surface)',
                  border: selected
                    ? `2px solid var(--tier${opt.tier})`
                    : '1px solid var(--border)',
                  borderRadius: 'var(--r)',
                  cursor: busy ? 'default' : 'pointer',
                  textAlign: 'left',
                  color: 'inherit',
                  fontFamily: 'inherit',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.76rem', color: `var(--tier${opt.tier})`, marginBottom: 2 }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: '0.64rem', color: 'var(--text3)' }}>{opt.blurb}</div>
                </div>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  {opt.price}
                </div>
              </button>
            );
          })}
        </div>
        {tierChanged && (demotingFromT3 || promotingToT3) && (
          <div style={{
            marginBottom: 14,
            padding: '7px 11px',
            background: promotingToT3 ? 'rgba(62,207,142,0.06)' : 'rgba(245,200,66,0.06)',
            border: promotingToT3 ? '1px solid rgba(62,207,142,0.2)' : '1px solid rgba(245,200,66,0.2)',
            borderRadius: 8,
            fontSize: '0.68rem',
            color: 'var(--text2)',
            lineHeight: 1.5,
          }}>
            {promotingToT3 ? (
              <><strong style={{ color: 'var(--green)' }}>Upsell:</strong> Promoting to Tier 3 unlocks the Brief Studio matrix once a master brief exists.</>
            ) : (
              <><strong style={{ color: 'var(--yellow)' }}>Heads up:</strong> Demoting from Tier 3 hides the Brief Studio matrix. The master brief and matrix data are preserved — promoting back to Tier 3 restores access.</>
            )}
          </div>
        )}

        <SectionTitle>Business details</SectionTitle>
        <Grid2>
          <Field label="Business name">
            <Input value={businessName} onChange={setBusinessName} placeholder="Northshore Plumbing" />
          </Field>
          <Field label="Founded year">
            <Input value={foundedYear} onChange={setFoundedYear} placeholder="2008" type="number" />
          </Field>
          <Field label="City">
            <Input value={city} onChange={setCity} placeholder="Mequon" />
          </Field>
          <Field label="State">
            <Input value={stateCode} onChange={setStateCode} placeholder="WI" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={setPhone} placeholder="(262) 555-0142" />
          </Field>
          <Field label="Email">
            <Input value={email} onChange={setEmail} placeholder="service@example.com" type="email" />
          </Field>
          <Field label="Owner name">
            <Input value={ownerName} onChange={setOwnerName} placeholder="Dan Kovacs" />
          </Field>
          <Field label="Tagline (optional)">
            <Input value={tagline} onChange={setTagline} placeholder="Honest plumbing, done right." />
          </Field>
        </Grid2>

        <Field label="Owner credentials (free text)">
          <Textarea
            value={ownerCredentials}
            onChange={setOwnerCredentials}
            placeholder='e.g. "Master Plumber, WI License #234567, 22 years in trade. Bradford White Pro Service partner."'
            rows={3}
          />
        </Field>

        <SectionTitle>Brand</SectionTitle>
        <Grid2>
          <Field label="Primary color">
            <ColorPair color={primaryColor} onChange={setPrimaryColor} />
          </Field>
          <Field label="Accent color">
            <ColorPair color={accentColor} onChange={setAccentColor} />
          </Field>
        </Grid2>

        <SectionTitle>Services ({services.length})</SectionTitle>
        <ChipList items={services} onRemove={(i) => removeChip(services, setServices, i)} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <Input
            value={newService}
            onChange={setNewService}
            placeholder="Add a service (e.g. Water Heater Replacement)"
            onEnter={() => addChip(setNewService, services, setServices, newService)}
          />
          <Button variant="ghost" size="sm" onClick={() => addChip(setNewService, services, setServices, newService)}>
            Add
          </Button>
        </div>

        <SectionTitle>Service areas ({serviceAreas.length})</SectionTitle>
        <ChipList items={serviceAreas} onRemove={(i) => removeChip(serviceAreas, setServiceAreas, i)} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <Input
            value={newArea}
            onChange={setNewArea}
            placeholder="Add a city (e.g. Cedarburg)"
            onEnter={() => addChip(setNewArea, serviceAreas, setServiceAreas, newArea)}
          />
          <Button variant="ghost" size="sm" onClick={() => addChip(setNewArea, serviceAreas, setServiceAreas, newArea)}>
            Add
          </Button>
        </div>

        <SectionTitle>Testimonials</SectionTitle>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>
            Mark which reviews to feature on the site. Edit text inline if needed. Add new ones the owner supplied.
          </div>
          {testimonials.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAllFeatured(!allFeatured)}
              title={allFeatured ? 'Uncheck every testimonial' : 'Check every testimonial'}
            >
              {allFeatured ? 'Deselect all' : `Select all (${testimonials.length})`}
            </Button>
          )}
        </div>
        {testimonials.map((t, idx) => (
          <TestimonialRow
            key={`t-${idx}`}
            value={t}
            onChange={(patch) => toggleTestimonial(idx, patch)}
            onRemove={() => removeTestimonial(idx)}
          />
        ))}
        <Button variant="ghost" size="sm" onClick={addBlankTestimonial}>+ Add testimonial</Button>

        <SectionTitle>Brand attributes (optional)</SectionTitle>
        <div style={{ fontSize: '0.65rem', color: 'var(--text3)', marginBottom: 10 }}>
          Free-form extras the prompt should weight (certifications, positioning statements, differentiators).
        </div>
        {extraAttrs.map((a, idx) => (
          <div key={`a-${idx}`} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <select
              value={a.category}
              onChange={(e) => updateExtraAttr(idx, { category: e.target.value as BrandAttributeCategory })}
              style={selectStyle}
            >
              <option value="certification">certification</option>
              <option value="positioning">positioning</option>
              <option value="differentiator">differentiator</option>
              <option value="value">value</option>
              <option value="review_theme">review_theme</option>
              <option value="other">other</option>
            </select>
            <Input value={a.value} onChange={(v) => updateExtraAttr(idx, { value: v })} placeholder="e.g. GAF Master Elite certified" />
            <Button variant="ghost" size="xs" onClick={() => removeExtraAttr(idx)}>✕</Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={addExtraAttr}>+ Add brand attribute</Button>

        {/* Danger Zone — bottom of the modal so it's never the first thing the
            operator sees, but still in-scope for "everything about this
            project lives in one place". */}
        {onDeleted && (
          <div style={{
            marginTop: 22,
            padding: 14,
            background: 'rgba(248,113,113,0.04)',
            border: '1px solid rgba(248,113,113,0.18)',
            borderRadius: 8,
          }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>
              Danger zone
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text2)', lineHeight: 1.5, marginBottom: 10 }}>
              Delete this project (client churn, mistaken qualification, etc). Cascades to all
              pages, briefs, brand attributes, and testimonials. The lead returns to the Pipeline
              with status <code>qualified</code> so you can re-qualify or move on.
            </div>
            {!confirmingDelete ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)} disabled={busy}>
                🗑 Delete project
              </Button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--red)' }}>
                  Really delete {project.business_name}? This cannot be undone.
                </span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleDelete}
                  disabled={busy}
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                >
                  {saving === 'deleting' ? <><Spinner /> Deleting…</> : 'Confirm delete'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
        {hasMaster && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={handleSave}>
            {saving === 'save' ? <><Spinner /> Saving…</> : 'Save'}
          </Button>
        )}
        <Button variant="primary" size="sm" disabled={busy} onClick={handleSaveAndRegen}>
          {saving === 'save+regen' ? <><Spinner /> {hasMaster ? 'Regenerating…' : 'Generating…'}</> : regenLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ============================================================================
// Local helpers
// ============================================================================

const labelStyle = { fontSize: '0.62rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase' as const, color: 'var(--text3)', margin: '14px 0 6px' };
const inputStyle = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r)',
  padding: '8px 10px',
  color: 'var(--text)',
  fontSize: '0.74rem',
  fontFamily: 'inherit',
};
const selectStyle = { ...inputStyle, padding: '7px 10px' };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', letterSpacing: '1.5px', color: 'var(--text)', margin: '20px 0 8px', paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
}

function Input({
  value, onChange, placeholder, type, onEnter,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; onEnter?: () => void;
}) {
  return (
    <input
      type={type ?? 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
      onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } } : undefined}
    />
  );
}

function Textarea({
  value, onChange, placeholder, rows,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows ?? 3}
      style={{ ...inputStyle, resize: 'vertical' }}
    />
  );
}

function ColorPair({ color, onChange }: { color: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="color" value={color} onChange={(e) => onChange(e.target.value)} style={{ width: 36, height: 30, border: 'none', background: 'none', cursor: 'pointer' }} />
      <input value={color} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, fontFamily: 'monospace' }} />
    </div>
  );
}

function ChipList({ items, onRemove }: { items: string[]; onRemove: (idx: number) => void }) {
  if (items.length === 0) {
    return <div style={{ fontSize: '0.65rem', color: 'var(--text3)', fontStyle: 'italic' }}>(none yet)</div>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((item, idx) => (
        <span
          key={`${item}-${idx}`}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            padding: '4px 6px 4px 10px',
            fontSize: '0.7rem',
            color: 'var(--text2)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {item}
          <button
            type="button"
            onClick={() => onRemove(idx)}
            style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1 }}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

function TestimonialRow({
  value, onChange, onRemove,
}: {
  value: DraftTestimonial; onChange: (patch: Partial<DraftTestimonial>) => void; onRemove: () => void;
}) {
  return (
    <div style={{
      background: value.is_featured ? 'var(--accent-dim)' : 'var(--surface2)',
      border: value.is_featured ? '1px solid rgba(255,107,43,0.3)' : '1px solid var(--border)',
      borderRadius: 'var(--r)',
      padding: 10,
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'var(--text2)' }}>
          <input
            type="checkbox"
            checked={value.is_featured}
            onChange={(e) => onChange({ is_featured: e.target.checked })}
          />
          Feature on site
        </label>
        <span style={{ fontSize: '0.62rem', color: 'var(--text3)' }}>
          {value.source} · {value.rating ?? '–'}★ {value.is_new ? '· (new)' : ''}
        </span>
        <button
          type="button"
          onClick={onRemove}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '0.75rem' }}
        >
          ✕ Remove
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
        <input value={value.author_name} onChange={(e) => onChange({ author_name: e.target.value })} placeholder="Author name" style={inputStyle} />
        <input value={value.author_location} onChange={(e) => onChange({ author_location: e.target.value })} placeholder="Location (e.g. Cedarburg, WI)" style={inputStyle} />
      </div>
      <textarea
        value={value.quote}
        onChange={(e) => onChange({ quote: e.target.value })}
        placeholder="Quote text"
        rows={2}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
    </div>
  );
}

function safeParseArr(raw: string | null | undefined, fallbackRaw?: string | null | undefined): string[] {
  for (const source of [raw, fallbackRaw]) {
    if (!source) continue;
    try {
      const v = JSON.parse(source);
      if (Array.isArray(v)) return v as string[];
    } catch {
      // continue
    }
  }
  return [];
}
