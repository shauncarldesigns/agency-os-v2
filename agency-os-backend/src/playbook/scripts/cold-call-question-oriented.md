---
id: cold-call-question-oriented
label: Cold call — Question-oriented
method: Discovery-first / referral-journey
default: false
stages:
  - id: permission
    label: PERMISSION
    short_label: Permission
    answers:
      - id: yes
        label: Yes, go ahead
        next_stage_id: lead-source
      - id: bad-time
        label: Bad time
        objection_id: too-busy-simple
      - id: what-is-this
        label: What is this about?
        next_stage_id: permission-what-is-this
      - id: not-interested
        label: Not interested
        objection_id: early-not-interested
  - id: lead-source
    label: DISCOVERY QUESTION
    short_label: Discovery
    answers:
      - id: referrals
        label: REFERRALS
        next_stage_id: customer-journey-referrals
        summary_field: lead_source
        summary_value: referrals
      - id: google
        label: GOOGLE
        next_stage_id: customer-journey-google
        summary_field: lead_source
        summary_value: google
      - id: social
        label: FACEBOOK / SOCIAL
        next_stage_id: customer-journey-social
        summary_field: lead_source
        summary_value: social
      - id: repeat
        label: REPEAT CUSTOMERS
        next_stage_id: customer-journey-repeat
        summary_field: lead_source
        summary_value: repeat_customers
      - id: paid-leads
        label: PAID LEADS
        next_stage_id: customer-journey-paid-leads
        summary_field: lead_source
        summary_value: paid_leads
      - id: mixed
        label: MIX OF SOURCES
        next_stage_id: customer-journey-mixed
        summary_field: lead_source
        summary_value: mixed
      - id: not-sure
        label: NOT SURE
        next_stage_id: customer-journey-not-sure
        summary_field: lead_source
        summary_value: not_sure
      - id: other
        label: OTHER
        next_stage_id: customer-journey-not-sure
        summary_field: lead_source
        summary_value: other
        free_text: true
        free_text_label: Source
  - id: permission-what-is-this
    label: PERMISSION — WHAT IS THIS ABOUT
    short_label: What is this?
    branch: true
    answers:
      - id: continue
        label: Continue to Lead Source
        next_stage_id: lead-source
  - id: customer-journey-referrals
    label: CUSTOMER JOURNEY — REFERRALS
    short_label: Journey · Referrals
    branch: true
    answers:
      - id: call-immediately
        label: Call immediately
        next_stage_id: referral-call-followup
        summary_field: customer_next_step
        summary_value: call_immediately
      - id: google-business
        label: Google the business
        next_stage_id: customer-looks-for-referral-google
        summary_field: customer_next_step
        summary_value: google_business
      - id: check-reviews
        label: Check reviews
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: check_reviews
      - id: facebook
        label: Look on Facebook
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: look_on_facebook
      - id: ask-referrer
        label: Ask the person who referred them
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: ask_referrer
      - id: not-sure
        label: Not sure
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: not_sure
  - id: referral-call-followup
    label: CUSTOMER JOURNEY — CALLS
    short_label: Journey · Calls
    branch: true
    answers:
      - id: most-call
        label: Most call immediately
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: most_call_immediately
      - id: some-look-up
        label: Some probably look us up
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: some_look_up
      - id: not-sure
        label: Not sure
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: not_sure
  - id: customer-looks-for-referral-google
    label: WHAT THEY FIND
    short_label: What they find
    branch: true
    selection_mode: multiple
    continue_stage_id: summary
    answers:
      - id: reviews
        label: REVIEWS
        summary_field: customer_looks_for
        summary_value: reviews
      - id: phone-number
        label: PHONE NUMBER
        summary_field: customer_looks_for
        summary_value: phone_number
      - id: google-profile
        label: GOOGLE PROFILE
        summary_field: customer_looks_for
        summary_value: google_profile
      - id: facebook-page
        label: FACEBOOK PAGE
        summary_field: customer_looks_for
        summary_value: facebook_page
      - id: photos
        label: PHOTOS
        summary_field: customer_looks_for
        summary_value: photos
      - id: not-sure
        label: NOT SURE
        summary_field: customer_looks_for
        summary_value: not_sure
      - id: not-much
        label: NOT MUCH
        summary_field: customer_looks_for
        summary_value: not_much
  - id: customer-journey-google
    label: CUSTOMER JOURNEY — GOOGLE
    short_label: Journey · Google
    branch: true
    selection_mode: multiple
    continue_stage_id: summary
    answers:
      - id: reviews
        label: Reviews
        summary_field: customer_looks_for
        summary_value: reviews
      - id: photos
        label: Photos
        summary_field: customer_looks_for
        summary_value: photos
      - id: services
        label: Services
        summary_field: customer_looks_for
        summary_value: services
      - id: contact
        label: Contact information
        summary_field: customer_looks_for
        summary_value: contact_information
      - id: location
        label: Location or service area
        summary_field: customer_looks_for
        summary_value: service_area
      - id: legitimacy
        label: Proof the business is legitimate
        summary_field: customer_looks_for
        summary_value: proof_legitimate
      - id: not-sure
        label: Not sure
        summary_field: customer_looks_for
        summary_value: not_sure
  - id: first-impression-google
    label: FIRST IMPRESSION — GOOGLE
    short_label: Impression · Google
    branch: true
    answers:
      - id: yes
        label: Yes
        next_stage_id: first-impression-everything-fine
        summary_field: current_process_assessment
        summary_value: seeing_everything
      - id: mostly
        label: Mostly
        next_stage_id: first-impression-everything-fine
        summary_field: current_process_assessment
        summary_value: mostly
      - id: missing
        label: A few things are missing
        next_stage_id: missing-information
        summary_field: current_process_assessment
        summary_value: missing_some_things
      - id: not-really
        label: Not really
        next_stage_id: missing-information
        summary_field: current_process_assessment
        summary_value: not_really
      - id: not-sure
        label: Not sure
        next_stage_id: first-impression
        summary_field: current_process_assessment
        summary_value: not_sure
  - id: customer-journey-social
    label: CUSTOMER JOURNEY — SOCIAL
    short_label: Journey · Social
    branch: true
    answers:
      - id: contact-direct
        label: Contact us directly
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: contact_directly
      - id: google-after
        label: Google us afterward
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: google_after_social
      - id: check-reviews
        label: Check reviews
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: check_reviews
      - id: browse-posts
        label: Browse posts and photos
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: browse_posts_photos
      - id: not-sure
        label: Not sure
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: not_sure
  - id: first-impression-social
    label: FIRST IMPRESSION — SOCIAL
    short_label: Impression · Social
    branch: true
    answers:
      - id: yes
        label: Yes, clear picture
        next_stage_id: first-impression-everything-fine
        summary_field: current_process_assessment
        summary_value: clear_picture
      - id: mostly
        label: Mostly
        next_stage_id: first-impression-everything-fine
        summary_field: current_process_assessment
        summary_value: mostly
      - id: missing
        label: Some things are missing
        next_stage_id: missing-information
        summary_field: current_process_assessment
        summary_value: missing_some_things
      - id: not-sure
        label: Not sure
        next_stage_id: first-impression
        summary_field: current_process_assessment
        summary_value: not_sure
  - id: customer-journey-repeat
    label: CUSTOMER JOURNEY — REPEAT
    short_label: Journey · Repeat
    branch: true
    answers:
      - id: call-immediately
        label: Call immediately
        next_stage_id: referral-call-followup
        summary_field: customer_next_step
        summary_value: call_immediately
      - id: google-business
        label: Google the business
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: google_business
      - id: check-reviews
        label: Check reviews
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: check_reviews
      - id: ask-referrer
        label: Ask the repeat customer more questions
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: ask_referrer
      - id: not-sure
        label: Not sure
        next_stage_id: summary
        summary_field: customer_next_step
        summary_value: not_sure
  - id: customer-journey-paid-leads
    label: CUSTOMER JOURNEY — PAID LEADS
    short_label: Journey · Paid
    branch: true
    selection_mode: multiple
    continue_stage_id: summary
    answers:
      - id: price
        label: Price
        summary_field: customer_looks_for
        summary_value: price
      - id: reviews
        label: Reviews
        summary_field: customer_looks_for
        summary_value: reviews
      - id: services
        label: Services
        summary_field: customer_looks_for
        summary_value: services
      - id: availability
        label: Availability
        summary_field: customer_looks_for
        summary_value: availability
      - id: photos
        label: Photos or examples
        summary_field: customer_looks_for
        summary_value: photos_examples
      - id: legitimacy
        label: Proof the business is legitimate
        summary_field: customer_looks_for
        summary_value: proof_legitimate
      - id: not-sure
        label: Not sure
        summary_field: customer_looks_for
        summary_value: not_sure
  - id: customer-journey-mixed
    label: CUSTOMER JOURNEY — MIXED
    short_label: Journey · Mixed
    branch: true
    answers:
      - id: primary-referrals
        label: Referrals
        next_stage_id: customer-journey-referrals
        summary_field: lead_source
        summary_value: referrals
      - id: primary-google
        label: Google
        next_stage_id: customer-journey-google
        summary_field: lead_source
        summary_value: google
      - id: primary-social
        label: Facebook / social media
        next_stage_id: customer-journey-social
        summary_field: lead_source
        summary_value: social
      - id: primary-repeat
        label: Repeat customers
        next_stage_id: customer-journey-repeat
        summary_field: lead_source
        summary_value: repeat_customers
      - id: primary-paid
        label: Paid lead services
        next_stage_id: customer-journey-paid-leads
        summary_field: lead_source
        summary_value: paid_leads
      - id: not-sure
        label: Not sure
        next_stage_id: customer-journey-not-sure
        summary_field: lead_source
        summary_value: not_sure
  - id: customer-journey-not-sure
    label: CUSTOMER JOURNEY — NOT SURE
    short_label: Journey · Unknown
    branch: true
    answers:
      - id: yes
        label: Yes
        next_stage_id: summary
        summary_field: current_process_assessment
        summary_value: asks_source
      - id: sometimes
        label: Sometimes
        next_stage_id: summary
        summary_field: current_process_assessment
        summary_value: sometimes_asks_source
      - id: no
        label: 'No'
        next_stage_id: summary
        summary_field: current_process_assessment
        summary_value: does_not_ask_source
      - id: forget
        label: I usually forget
        next_stage_id: summary
        summary_field: current_process_assessment
        summary_value: usually_forgets
  - id: repeated-questions
    label: CUSTOMER QUESTIONS
    short_label: Questions
    branch: true
    selection_mode: multiple
    continue_stage_id: first-impression
    answers:
      - id: services
        label: What services do you offer?
        summary_field: repeated_questions
        summary_value: services
      - id: service-area
        label: Do you serve my area?
        summary_field: repeated_questions
        summary_value: service_area
      - id: cost
        label: How much does it cost?
        summary_field: repeated_questions
        summary_value: cost
      - id: license
        label: Are you licensed or insured?
        summary_field: repeated_questions
        summary_value: licensing_insurance
      - id: examples
        label: Can I see examples?
        summary_field: repeated_questions
        summary_value: examples
      - id: availability
        label: When are you available?
        summary_field: repeated_questions
        summary_value: availability
      - id: something-else
        label: Something else
        summary_field: repeated_questions
        summary_value: something_else
  - id: first-impression
    label: FIRST IMPRESSION
    short_label: First impression
    branch: true
    answers:
      - id: yes-definitely
        label: Yes, definitely
        next_stage_id: first-impression-everything-fine
        summary_field: current_process_assessment
        summary_value: seeing_everything
      - id: mostly
        label: Mostly
        next_stage_id: first-impression-everything-fine
        summary_field: current_process_assessment
        summary_value: mostly
      - id: missing
        label: There are a few things missing
        next_stage_id: missing-information
        summary_field: current_process_assessment
        summary_value: missing_some_things
      - id: not-really
        label: Not really
        next_stage_id: missing-information
        summary_field: current_process_assessment
        summary_value: not_really
      - id: never-thought
        label: I have never thought about it
        next_stage_id: missing-information
        summary_field: current_process_assessment
        summary_value: never_thought_about_it
      - id: not-sure
        label: I am not sure
        next_stage_id: missing-information
        summary_field: current_process_assessment
        summary_value: not_sure
  - id: first-impression-everything-fine
    label: FIRST IMPRESSION — WORKING
    short_label: Working
    branch: true
    selection_mode: multiple
    continue_stage_id: summary
    answers:
      - id: services
        label: Services
        summary_field: repeated_questions
        summary_value: services
      - id: pricing
        label: Pricing
        summary_field: repeated_questions
        summary_value: pricing
      - id: photos
        label: Photos
        summary_field: repeated_questions
        summary_value: photos
      - id: service-area
        label: Service area
        summary_field: repeated_questions
        summary_value: service_area
      - id: hours
        label: Hours
        summary_field: repeated_questions
        summary_value: hours
      - id: reviews
        label: Reviews
        summary_field: repeated_questions
        summary_value: reviews
      - id: licensing
        label: Licensing or insurance
        summary_field: repeated_questions
        summary_value: licensing_insurance
      - id: no
        label: No, not really
        next_stage_id: graceful-exit
        summary_field: current_process_assessment
        summary_value: current_process_working
  - id: graceful-exit
    label: GRACEFUL EXIT
    short_label: Exit
    branch: true
    answers:
      - id: finish
        label: Finish call
  - id: missing-information
    label: MISSING INFORMATION
    short_label: Missing info
    branch: true
    selection_mode: multiple
    continue_stage_id: information-help
    answers:
      - id: services
        label: Services offered
        summary_field: missing_information
        summary_value: services
      - id: reviews
        label: Reviews
        summary_field: missing_information
        summary_value: reviews
      - id: photos
        label: Photos of our work
        summary_field: missing_information
        summary_value: photos
      - id: service-area
        label: Service area
        summary_field: missing_information
        summary_value: service_area
      - id: contact
        label: Contact information
        summary_field: missing_information
        summary_value: contact_information
      - id: credentials
        label: Licensing or credentials
        summary_field: missing_information
        summary_value: credentials
      - id: faq
        label: Frequently asked questions
        summary_field: missing_information
        summary_value: faq
      - id: something-else
        label: Something else
        summary_field: missing_information
        summary_value: something_else
  - id: information-help
    label: INFORMATION HELP
    short_label: Info help
    branch: true
    answers:
      - id: easier
        label: It would make it easier
        next_stage_id: summary
        summary_field: current_process_assessment
        summary_value: clear_place_would_help
      - id: maybe
        label: Maybe
        next_stage_id: summary
        summary_field: current_process_assessment
        summary_value: maybe_help
      - id: probably-not
        label: Probably not
        next_stage_id: graceful-exit
        summary_field: current_process_assessment
        summary_value: probably_not_help
      - id: not-sure
        label: Not sure
        next_stage_id: summary
        summary_field: current_process_assessment
        summary_value: not_sure
  - id: summary
    label: SUMMARY
    short_label: Summary
    answers:
      - id: reveal-reviews
        label: Reveal - reviews
        next_stage_id: solution-reveal-reviews
      - id: reveal-legit
        label: Reveal - legit
        next_stage_id: solution-reveal-legit
      - id: needs-changes
        label: Needs changes
  - id: solution-reveal-reviews
    label: SOLUTION REVEAL
    short_label: Reveal - Reviews
    branch: true
    reveal_solution: true
    answers:
      - id: continue
        label: Advance to Demo Ask
        next_stage_id: demo-ask
  - id: solution-reveal-legit
    label: SOLUTION REVEAL
    short_label: Reveal - Legit
    branch: true
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
      - id: maybe
        label: Maybe — what does it involve?
        objection_id: too-busy-simple
      - id: send-it
        label: Just send it to me
        objection_id: send-email
      - id: how-much
        label: How much does it cost?
        objection_id: cant-afford
      - id: no-website
        label: I do not need a website
        objection_id: why-need-website-direct
      - id: too-busy
        label: I am too busy
        objection_id: too-busy-simple
      - id: not-interested
        label: Not interested
        objection_id: total-brush-off
---

## Stage: permission

"Hey [Name], this is Shaun. I know you weren't expecting my call so I'll be quick. Can I ask a couple of quick questions about how business is coming in for you?"

> If they ask what this is about before giving permission, use the branch response. Do not name the offer or imply anything is already being built.

## Stage: lead-source

"How are most of your new customers finding you right now?"

> Keep this completely open-ended. Do not read the chip options out loud. Listen to the answer, then classify it with the closest chip so the app has structured data for the summary.

## Stage: permission-what-is-this

"Fair question. I work with local businesses about where customers are coming from but I don't want to assume you need anything. I was just hoping to understand how customers normally find and evaluate your business."

> Do not name the offer or imply anything is already being built.

## Stage: customer-journey-referrals

"Got it. After someone is referred to you, how do they usually check you out?"

> Listen for whether they call directly, look the business up, ask for proof, or rely completely on the referrer.

## Stage: referral-call-followup

"That makes sense. Do you think most call immediately, or do some still look you up before dialing?"

> Keep this light. You are not trying to argue with "they call immediately"; you are checking whether there is still a lookup step.

## Stage: customer-looks-for-referral-google

"And when they Google you, what do you think they'll find?"

> Multi-select what they name. This identifies the gap before the reveal without adding a long diagnostic loop.

## Stage: customer-journey-google

"When someone finds you on Google, what do you think they usually look at before calling?"

> Multi-select the specifics they name, then confirm the short summary and move to the reveal.

## Stage: first-impression-google

"Do you feel like they are seeing everything you would want them to see?"

> This is a fit check, not a setup. If they say everything looks good, test gently for repeated questions.

## Stage: customer-journey-social

"When someone finds you through Facebook, do they usually contact you there, or do they search for more information first?"

> Do not criticize Facebook. Learn whether Facebook is the whole journey or just one touchpoint.

## Stage: first-impression-social

"Does that give them a clear picture of everything you offer?"

> If social is working well for them, let that be true.

## Stage: customer-journey-repeat

"When a repeat customer recommends you to somebody new, what do you think that new person normally does next?"

> This is the referral journey with a repeat-customer source. Keep the language familiar.

## Stage: customer-journey-paid-leads

"Once you receive the lead, what does that customer usually need to see or hear before deciding to work with you?"

> Do not ask what the lead costs. This is about what the customer needs to understand before choosing.

## Stage: customer-journey-mixed

"Which source tends to send you the most serious customers?"

> Pick the dominant source and route into that matching journey. If they cannot pick, use Not sure.

## Stage: customer-journey-not-sure

"When a new customer calls, do you normally ask how they found you?"

> No judgment. This just establishes how clear the customer path is today.

## Stage: repeated-questions

"What do they tend to ask before deciding whether to move forward?"

> Multi-select repeated questions only if the owner actually names them.

## Stage: first-impression

"When someone looks you up, do you feel like they are seeing everything you would want them to see?"

> If they identify no gap, do not force a pitch. The truthful value proposition only matters when a clearer place would be useful.

## Stage: first-impression-everything-fine

"Have customers ever asked for information that you thought should have been easy for them to find?"

> If they keep identifying no gap, take the graceful exit.

## Stage: graceful-exit

"Got it. It sounds like your current process is working pretty well. I appreciate you answering the question."

> Do not force the call toward a pitch when no meaningful gap exists.

## Stage: missing-information

"What would you most want them to see before they call?"

> Multi-select what they explicitly name. This becomes the clearest bridge to the reveal.

## Stage: information-help

"Would having that information in one clear place make those referral conversations easier, or would it not make much difference?"

> If they say it would not help, exit gracefully.

## Stage: summary

"So it sounds like..."

> Confirm the short version before the reveal: "So it sounds like most business comes from referrals, and people check you out online before calling?" Use the Summary card below, but keep it conversational and brief.

## Stage: solution-reveal-reviews

"Hey, the good news is your reviews are strong, but beyond that, there isn't much showing what you do or why to choose you."

"That's why I called today. I looked you up, saw the great reviews, but didn't find a site that showcases your business, so I put together a quick example that gives people a professional place to land after they search."

> This is the first stage where website-specific language is allowed. Do not claim a website guarantees leads, revenue, better customers, or replaces referrals. The truthful claim is that it gives customers a clear, professional place to understand the business after they search.

## Stage: solution-reveal-legit

"So when someone checks you out, they may see a phone number and some reviews, but not enough to get a full picture of the business. In some cases, that can make a legitimate company look less established than it really is."

"That's exactly why I called. I put together an example that shows your services, your reviews, your work, and gives people a professional place to land after they search."

> This is the first stage where website-specific language is allowed. Do not claim a website guarantees leads, revenue, better customers, or replaces referrals. The truthful claim is that it gives customers a clear, professional place to understand the business after they search.

## Stage: demo-ask

"Would it be unreasonable to spend ten minutes taking a look?"

Alternative:

"I put together a simple example using the kind of information customers already look for — your services, reviews, photos, and contact details. Would it be worth a quick look?"
