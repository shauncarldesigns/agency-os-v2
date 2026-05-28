import { useState, useEffect } from 'react';
import type {
  Project, Lead, ShowToast, Brief, BrandAttributeCategory,
} from '../../lib/types';
import { Modal, ModalHeader } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { api, ApiError } from '../../lib/api';

interface OperatorInputFormProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  lead: Lead | null;
  showToast: ShowToast;
  onBriefGenerated: (brief: Brief) => void;
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

const PHOTO_PRESETS = [
  { label: 'Rugged contractor', value: 'Real crews on real jobs — trucks, tools, finished work. No stock.' },
  { label: 'Warm family', value: 'Family-run feel — owner with crew, homeowner handoff, kids and pets if relevant.' },
  { label: 'Modern minimal', value: 'Clean, high-contrast shots. Sparse compositions. Brand-color accents.' },
];

export function OperatorInputForm({ open, onClose, project, lead, showToast, onBriefGenerated }: OperatorInputFormProps) {
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
  const [photographyDirection, setPhotographyDirection] = useState(project.photography_direction ?? '');
  const [services, setServices] = useState<string[]>(safeParseArr(project.services, lead?.extracted_services));
  const [serviceAreas, setServiceAreas] = useState<string[]>(safeParseArr(project.service_areas, lead?.extracted_service_areas));
  const [newService, setNewService] = useState('');
  const [newArea, setNewArea] = useState('');
  const [testimonials, setTestimonials] = useState<DraftTestimonial[]>([]);
  const [extraAttrs, setExtraAttrs] = useState<DraftBrandAttr[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<'idle' | 'running' | 'done' | 'skipped' | 'failed'>('idle');
  const [scrapeMessage, setScrapeMessage] = useState<string>('');

  // Seed testimonials + auto-trigger scrape if needed.
  useEffect(() => {
    if (!open) return;
    void seedTestimonials();
    void maybeRunScrape();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.id]);

  async function maybeRunScrape() {
    // Auto-run scrape if the lead has a website and we haven't scraped yet.
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
    // Layer in raw Google reviews from the lead that aren't already mirrored.
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

  async function handleSubmit() {
    if (!businessName.trim()) {
      showToast('Business name required', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // 1) Update project fields
      const yearNum = foundedYear.trim() ? Number(foundedYear.trim()) : null;
      await api.projects.update(project.id, {
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
        photography_direction: photographyDirection.trim() || null,
        services,
        service_areas: serviceAreas,
      } as unknown as Partial<Project>);

      // 2) Persist testimonials. Insert new ones; update featured-flag on existing ones.
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

      // 3) Persist extra brand attributes (free-form).
      for (const a of extraAttrs) {
        if (!a.value.trim()) continue;
        await api.brandAttributes.create(project.id, {
          category: a.category,
          value: a.value.trim(),
          source: 'operator',
        });
      }

      // 4) Generate master brief (full_site).
      const brief = await api.briefs.master(project.id);
      showToast('Master brief generated', 'success');
      onBriefGenerated(brief);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Submit failed: ${msg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // True only when every testimonial is featured — drives the bulk toggle's
  // label/behavior (Select all vs Deselect all).
  const allFeatured = testimonials.length > 0 && testimonials.every((t) => t.is_featured);

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onClose} width={780}>
      <ModalHeader title={`Master Brief — ${project.business_name}`} onClose={submitting ? () => undefined : onClose} />

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

        <Field label="Photography direction">
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            {PHOTO_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPhotographyDirection(p.value)}
                style={{
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontSize: '0.65rem',
                  color: 'var(--text2)',
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Textarea
            value={photographyDirection}
            onChange={setPhotographyDirection}
            placeholder="Real crews on real jobs, no stock photos. Show trucks, tools, and the homeowner handoff."
            rows={2}
          />
        </Field>

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
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={submitting} onClick={handleSubmit}>
          {submitting ? <><Spinner /> Saving + generating…</> : '✦ Save & generate master brief'}
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
