// Per-page brief: the conversational prompt Cowork pastes into landingsite.ai
// for each individual page after the initial site brief.

export interface PageBriefInput {
  businessName: string;
  phone: string | null;
  state: string | null;
  brandVoiceNotes: string | null;
  pageType: 'homepage' | 'service' | 'service-area' | 'about' | 'faq' | 'contact';
  service?: string;
  city?: string;
  customerQuote?: { author: string; location?: string; quote: string };
  serviceAreas?: string[];   // for homepage / context
  localContext?: string[];   // neighborhoods / landmarks / weather / housing
}

export function buildPageBriefPrompt(input: PageBriefInput): string {
  if (input.pageType === 'service-area') {
    return buildServiceAreaPagePrompt(input);
  }
  if (input.pageType === 'service') {
    return buildServicePagePrompt(input);
  }
  if (input.pageType === 'homepage') {
    return buildHomepagePrompt(input);
  }
  return buildGenericPagePrompt(input);
}

function buildServiceAreaPagePrompt(input: PageBriefInput): string {
  const service = input.service ?? '(service)';
  const city = input.city ?? '(city)';
  const state = input.state ?? 'WI';
  const ctx = (input.localContext ?? []).join(', ');
  return `Build a service-area page for ${service} in ${city}, ${state}.

URL: /service-areas/${slug(service)}-${slug(city)}-${state.toLowerCase()}
H1: should mention both "${service}" and "${city}" specifically.

Local context to incorporate:
${ctx ? `- ${ctx}` : '- (use general knowledge of the area)'}

${input.customerQuote
  ? `Customer testimonial to use:
"${input.customerQuote.quote}" — ${input.customerQuote.author}${input.customerQuote.location ? `, ${input.customerQuote.location}` : ''}`
  : ''}

Meta title: "${service} in ${city}, ${state} | ${input.businessName}"
Meta description: 150-160 characters mentioning the service, ${city}, and phone ${input.phone ?? '(business phone)'}.

Brand voice: ${input.brandVoiceNotes ?? 'Local, trustworthy, direct. 6th-8th grade reading level. Active voice. Zero fluff.'}
Use the customer testimonial in a prominent testimonial section.
Include CTA with phone number ${input.phone ?? '(business phone)'}.`;
}

function buildServicePagePrompt(input: PageBriefInput): string {
  const service = input.service ?? '(service)';
  const state = input.state ?? 'WI';
  return `Build a service page for ${service}.

URL: /services/${slug(service)}
H1: clear, action-oriented headline featuring "${service}".

Meta title: "${service} | ${input.businessName} · ${state}"
Meta description: 150-160 characters mentioning the service, location coverage, and phone ${input.phone ?? '(business phone)'}.

${input.customerQuote
  ? `Customer testimonial to use:
"${input.customerQuote.quote}" — ${input.customerQuote.author}${input.customerQuote.location ? `, ${input.customerQuote.location}` : ''}`
  : ''}

Brand voice: ${input.brandVoiceNotes ?? 'Local, trustworthy, direct. 6th-8th grade reading level. Active voice. Zero fluff.'}
Include CTA with phone number ${input.phone ?? '(business phone)'}.`;
}

function buildHomepagePrompt(input: PageBriefInput): string {
  const state = input.state ?? 'WI';
  const areas = (input.serviceAreas ?? []).slice(0, 6).join(', ');
  return `Build the homepage for ${input.businessName}.

URL: /
H1: hero headline with the business name and core value prop.

Coverage: ${areas || '(home city)'} (${state}).

Meta title: "${input.businessName} | ${state} Local"
Meta description: 150-160 characters with the value prop and phone ${input.phone ?? '(business phone)'}.

${input.customerQuote
  ? `Customer testimonial to feature:
"${input.customerQuote.quote}" — ${input.customerQuote.author}${input.customerQuote.location ? `, ${input.customerQuote.location}` : ''}`
  : ''}

Brand voice: ${input.brandVoiceNotes ?? 'Local, trustworthy, direct. 6th-8th grade reading level. Active voice. Zero fluff.'}
Include LocalBusiness schema. Include CTA with phone ${input.phone ?? '(business phone)'} above the fold.`;
}

function buildGenericPagePrompt(input: PageBriefInput): string {
  const state = input.state ?? 'WI';
  const titles: Record<string, string> = {
    about: 'About',
    contact: 'Contact',
    faq: 'FAQ',
  };
  const title = titles[input.pageType] ?? input.pageType;
  return `Build the ${title} page for ${input.businessName}.

URL: /${slug(title)}

Meta title: "${title} | ${input.businessName}"
Meta description: 150-160 characters appropriate to a ${title} page.

Brand voice: ${input.brandVoiceNotes ?? 'Local, trustworthy, direct. 6th-8th grade reading level. Active voice. Zero fluff.'}
Include CTA with phone ${input.phone ?? '(business phone)'}.
${input.pageType === 'contact' ? `\nList the phone, email if available, and service areas: ${(input.serviceAreas ?? []).join(', ') || '(home city)'}.` : ''}
${input.pageType === 'faq' ? `\nGenerate 6-8 FAQs based on common ${input.pageType === 'faq' ? 'service questions' : 'questions'} for businesses in ${state}.` : ''}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}
