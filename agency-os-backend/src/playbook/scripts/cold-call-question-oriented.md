---
id: cold-call-question-oriented
label: Cold call — Question-oriented
method: Sandler / discovery-first
default: false
stages:
  - id: permission
    label: PERMISSION
    short_label: Permission
    answers:
      - id: yes
        label: Yes
        next_stage_id: lead-source
      - id: bad-time
        label: Bad time
        objection_id: too-busy-simple
      - id: what-is-this
        label: What is this about?
        objection_id: why-are-you-asking
      - id: not-interested
        label: Not interested
        objection_id: early-not-interested
  - id: lead-source
    label: LEAD SOURCE
    short_label: Lead source
    answers:
      - id: referrals
        label: Word of mouth / referrals
        qualification_tag: lead_source_referrals
        next_stage_id: qualification-referrals
      - id: google
        label: Google
        qualification_tag: lead_source_google
        next_stage_id: qualification-google
      - id: social
        label: Facebook / social media
        qualification_tag: lead_source_social
        next_stage_id: qualification-social
      - id: paid-leads
        label: Paid lead services
        qualification_tag: lead_source_paid_leads
        next_stage_id: qualification-paid-leads
      - id: repeat
        label: Repeat customers
        qualification_tag: lead_source_repeat
        next_stage_id: qualification-repeat
      - id: mixed
        label: A mix of things
        qualification_tag: lead_source_mixed
        next_stage_id: qualification-mixed
      - id: not-sure
        label: Not sure
        qualification_tag: lead_source_unknown
        next_stage_id: qualification-not-sure
  - id: qualification-referrals
    label: QUALIFY — REFERRALS
    short_label: Qualify · Referrals
    branch: true
    answers:
      - id: enough
        label: Referrals keep us busy
        qualification_tag: already_busy
        next_stage_id: impact
      - id: consistency
        label: Could use more consistency
        qualification_tag: problem_inconsistent_leads
        next_stage_id: impact
      - id: waves
        label: Business comes in waves
        qualification_tag: problem_seasonal_or_unpredictable
        next_stage_id: impact
      - id: better-jobs
        label: Want better-quality jobs
        qualification_tag: problem_job_quality
        next_stage_id: impact
      - id: too-busy
        label: Already too busy
        qualification_tag: already_busy
        next_stage_id: impact
  - id: qualification-google
    label: QUALIFY — GOOGLE
    short_label: Qualify · Google
    branch: true
    answers:
      - id: reviews
        label: Our reviews
        qualification_tag: google_reviews
        next_stage_id: impact
      - id: price
        label: Price
        qualification_tag: problem_price_shopping
        next_stage_id: impact
      - id: calls-around
        label: They call several companies
        qualification_tag: problem_competing_quotes
        next_stage_id: impact
      - id: know-name
        label: They already know our name
        qualification_tag: brand_familiarity
        next_stage_id: impact
      - id: not-sure
        label: Not sure
        qualification_tag: problem_no_tracking
        next_stage_id: impact
  - id: qualification-social
    label: QUALIFY — SOCIAL
    short_label: Qualify · Social
    branch: true
    answers:
      - id: consistent
        label: Consistent leads
        qualification_tag: social_consistent
        next_stage_id: impact
      - id: credibility
        label: Mostly credibility
        qualification_tag: problem_social_only_credibility
        next_stage_id: impact
      - id: occasional
        label: Occasional leads
        qualification_tag: problem_inconsistent_social
        next_stage_id: impact
      - id: barely
        label: Barely use it
        qualification_tag: problem_low_visibility
        next_stage_id: impact
      - id: not-sure
        label: Not sure
        qualification_tag: problem_no_tracking
        next_stage_id: impact
  - id: qualification-paid-leads
    label: QUALIFY — PAID LEADS
    short_label: Qualify · Paid leads
    branch: true
    answers:
      - id: profitable
        label: They are profitable
        qualification_tag: paid_leads_working
        next_stage_id: impact
      - id: competition
        label: Too much competition
        qualification_tag: problem_shared_leads
        next_stage_id: impact
      - id: expensive
        label: Leads are expensive
        qualification_tag: problem_lead_cost
        next_stage_id: impact
      - id: poor-quality
        label: Lead quality is poor
        qualification_tag: problem_lead_quality
        next_stage_id: impact
      - id: inconsistent
        label: Results are inconsistent
        qualification_tag: problem_paid_lead_consistency
        next_stage_id: impact
  - id: qualification-repeat
    label: QUALIFY — REPEAT
    short_label: Qualify · Repeat
    branch: true
    answers:
      - id: enough
        label: Repeat business is enough
        qualification_tag: repeat_business_enough
        next_stage_id: impact
      - id: need-new
        label: Need new customers
        qualification_tag: problem_needs_new_customers
        next_stage_id: impact
      - id: growth
        label: Want to grow
        qualification_tag: problem_growth
        next_stage_id: impact
      - id: larger
        label: Want larger jobs
        qualification_tag: problem_job_value
        next_stage_id: impact
      - id: inconsistent
        label: Business is inconsistent
        qualification_tag: problem_inconsistent_leads
        next_stage_id: impact
  - id: qualification-mixed
    label: QUALIFY — MIXED
    short_label: Qualify · Mixed
    branch: true
    answers:
      - id: primary-referrals
        label: Referrals bring the best
        qualification_tag: lead_source_referrals
        next_stage_id: impact
      - id: primary-google
        label: Google brings the best
        qualification_tag: lead_source_google
        next_stage_id: impact
      - id: primary-social
        label: Social brings the best
        qualification_tag: lead_source_social
        next_stage_id: impact
      - id: primary-paid
        label: Paid leads bring the best
        qualification_tag: lead_source_paid_leads
        next_stage_id: impact
      - id: primary-repeat
        label: Repeat brings the best
        qualification_tag: lead_source_repeat
        next_stage_id: impact
  - id: qualification-not-sure
    label: QUALIFY — NOT SURE
    short_label: Qualify · Unknown
    branch: true
    answers:
      - id: yes
        label: Yes, we track it
        qualification_tag: tracks_leads
        next_stage_id: impact
      - id: somewhat
        label: Somewhat
        qualification_tag: partial_tracking
        next_stage_id: impact
      - id: no
        label: No
        qualification_tag: problem_no_tracking
        next_stage_id: impact
      - id: never-looked
        label: Never really looked at it
        qualification_tag: problem_no_tracking
        next_stage_id: impact
  - id: impact
    label: IMPACT
    short_label: Impact
    answers:
      - id: under-500
        label: Under $500
        qualification_tag: job_value_under_500
        next_stage_id: desired-outcome
      - id: 500-1000
        label: $500–$1,000
        qualification_tag: job_value_500_1000
        next_stage_id: desired-outcome
      - id: 1000-2500
        label: $1,000–$2,500
        qualification_tag: job_value_1000_2500
        next_stage_id: desired-outcome
      - id: 2500-5000
        label: $2,500–$5,000
        qualification_tag: job_value_2500_5000
        next_stage_id: desired-outcome
      - id: 5000-plus
        label: $5,000+
        qualification_tag: job_value_5000_plus
        next_stage_id: desired-outcome
      - id: depends
        label: Depends on the job
        next_stage_id: desired-outcome
      - id: not-sure
        label: Not sure
        next_stage_id: desired-outcome
  - id: desired-outcome
    label: DESIRED OUTCOME
    short_label: Desired outcome
    answers:
      - id: more-leads
        label: More leads
        qualification_tag: goal_more_leads
        next_stage_id: solution-reveal
      - id: consistency
        label: More consistency
        qualification_tag: goal_consistency
        next_stage_id: solution-reveal
      - id: better-jobs
        label: Better-paying jobs
        qualification_tag: goal_better_jobs
        next_stage_id: solution-reveal
      - id: better-customers
        label: Better-quality customers
        qualification_tag: goal_better_customers
        next_stage_id: solution-reveal
      - id: less-referrals
        label: Less dependence on referrals
        qualification_tag: goal_less_referrals
        next_stage_id: solution-reveal
      - id: less-paid
        label: Less dependence on paid leads
        qualification_tag: goal_less_paid_leads
        next_stage_id: solution-reveal
      - id: tracking
        label: Better tracking
        qualification_tag: goal_tracking
        next_stage_id: solution-reveal
      - id: nothing
        label: Not looking to change anything
        qualification_tag: goal_none
        next_stage_id: solution-reveal
  - id: solution-reveal
    label: SOLUTION REVEAL
    short_label: Reveal
    reveal_solution: true
    answers:
      - id: continue
        label: Advance to Demo Ask
        next_stage_id: demo-ask
  - id: demo-ask
    label: DEMO ASK
    short_label: Demo ask
    reveal_solution: true
    answers:
      - id: book
        label: Yes — book demo
      - id: narrow-time
        label: Maybe — narrow time
        objection_id: too-busy-simple
      - id: send-email
        label: Just email it
        objection_id: send-email
      - id: how-much
        label: How much?
        objection_id: cant-afford
      - id: think
        label: Need to think
        objection_id: talk-to-partner
      - id: not-interested
        label: Not interested
        objection_id: total-brush-off
---

## Stage: permission

"Hey, is this [Name]?"

Then:

"Hey [Name], this is Shaun. I know you weren't expecting my call. Can I ask you a quick question about the business?"

> Do NOT mention websites, marketing services, or that anything has already been built. This is a discovery call — you don't have a solution yet.

## Stage: lead-source

"How are most new customers finding you right now?"

> Ask neutrally. Do not imply that their current method is inadequate. You are gathering signal, not steering.

## Stage: qualification-referrals

"Would you say referrals keep you as busy as you want to be, or would you still like a more consistent flow of new customers?"

> If they're happy, don't fight it — pivot toward better-quality or higher-margin work. If they want more, that's your opening for the Impact stage.

## Stage: qualification-google

"Do you know what usually makes someone choose you after they find you on Google?"

> This surfaces whether their Google presence is passive (they get calls but don't know why) or active (they track what converts). Both are useful signal.

## Stage: qualification-social

"Does social media produce new customers consistently, or is it mostly somewhere people verify that the business is active?"

> Most local trades use social for credibility. Naming that out loud gives them permission to be honest without feeling like they're admitting it doesn't work.

## Stage: qualification-paid-leads

"Are those leads generally profitable, or do you end up competing with several companies for the same job?"

> Shared-lead frustration is one of the highest-signal openings you'll get — HomeAdvisor / Angi / Networx pain is universal in the trades.

## Stage: qualification-repeat

"Are repeat customers enough to support the growth you want, or do you still need a steady source of new business?"

> Repeat is stable but caps upside. If they want growth, that's the door in.

## Stage: qualification-mixed

"Which of those sources tends to bring you the best customers?"

> Pick their primary and route into that qualification variant. If they can't pick, treat it as "not sure" — that's its own tell.

## Stage: qualification-not-sure

"Do you currently have any way to track where calls or new customers are coming from?"

> Not tracking is often a bigger problem than any specific lead source — it means they can't tell what's working. Note it as `problem_no_tracking`.

## Stage: impact

"What does an average job usually bring in for you?"

> Quantify without turning this into a pricing conversation. This anchors what "worth it" means for the demo.

## Stage: desired-outcome

"Ideally, would you want more total leads, more predictable leads, or better-quality jobs?"

> This is the pivot line. Their answer sets the frame for the reveal — the concept you show them will "help with that."

## Stage: solution-reveal

"The reason I asked is that I help local businesses improve what potential customers find when they research them and give those customers a clearer reason to call."

> This is the first stage where the service may be revealed. Website-specific objections unlock here. Connect it directly to what they told you: "Based on what you said about relying on referrals and wanting a more predictable flow of higher-value jobs, I may have something worth showing you."

## Stage: demo-ask

"I put together a website concept for your business using your existing information and reviews. Would it be unreasonable to spend ten minutes looking at it together?"

> Alternative: "Based on what you just told me, I may have already built something that helps with that. Would it be worth ten minutes to see what it looks like?"
