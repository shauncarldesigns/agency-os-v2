ALTER TABLE messaging_scripts ADD COLUMN source_reference TEXT;

UPDATE messaging_scripts SET
  body = 'Hey [Name], this is Shaun — I put together a homepage for [Company], no charge, just wanted you to see it:\n\n[demo link]\n\nTake a look when you get a sec, curious what you think.',
  approved = 1,
  source_reference = 'leadpipeline/AutomatedPipelinePanel.tsx#TextComposerModal',
  updated_at = datetime('now')
WHERE script_key = 'initial';

UPDATE messaging_scripts SET
  body = 'Hey [Name], just wanted to bump this back up in case it got buried.\nI put together that homepage specifically for [Company]:\n[demo link]\n\nCurious what you think whenever you get a chance.',
  approved = 1,
  source_reference = 'leadpipeline/AutomatedPipelinePanel.tsx#FollowUpModal.nurtureText',
  updated_at = datetime('now')
WHERE script_key = 'follow_up';

UPDATE messaging_scripts SET
  body = 'Fair question. Most guys hear ''website'' and assume it''s five, ten grand. I''ve got options that get you up and running for under a grand. But honestly, until you see what I put together, throwing numbers around isn''t gonna mean much. Let''s do the ten minutes — you see it, and then we talk price on the back end. Fair?',
  approved = 1,
  source_reference = 'playbook/objections/quick-cost.md',
  updated_at = datetime('now')
WHERE script_key = 'price_question';

UPDATE messaging_scripts SET
  body = 'My name is Shaun — I build websites for local businesses here in Wisconsin and help them get found on Google.',
  approved = 1,
  source_reference = 'playbook/scripts/cold-call-no-oriented.md#intro',
  updated_at = datetime('now')
WHERE script_key = 'who_is_this';

UPDATE messaging_scripts SET
  body = 'I put together a sample website for [Company] — nothing live, no cost. Just a visual, so you can see what it might look like if your online presence matched the reputation your reviews already show: [demo link]',
  approved = 1,
  source_reference = 'playbook/scripts/cold-call-quick-oriented.md#demo-reveal',
  updated_at = datetime('now')
WHERE script_key = 'what_is_this';

UPDATE messaging_scripts SET
  body = 'Oh nice — how are you ranking?',
  approved = 1,
  source_reference = 'playbook/scripts/cold-call-no-oriented.md#hook',
  updated_at = datetime('now')
WHERE script_key = 'already_has_website';

UPDATE messaging_scripts SET
  body = 'Worst case, you spend ten minutes, you don''t like it, you tell me to go pound sand. No cost, no obligation. Best case, you like it and we move forward. What''s a good time to take a look?',
  approved = 1,
  source_reference = 'playbook/scripts/cold-call-quick-oriented.md#close',
  updated_at = datetime('now')
WHERE script_key = 'positive_interest';

UPDATE messaging_scripts SET
  body = 'Perfect. What''s a good day this week?',
  approved = 1,
  source_reference = 'playbook/scripts/cold-call-no-oriented.md#close-1',
  updated_at = datetime('now')
WHERE script_key = 'wants_call';

UPDATE messaging_scripts SET
  body = NULL,
  approved = 0,
  source_reference = 'leadpipeline/AutomatedPipelinePanel.tsx#archive-not-interested',
  updated_at = datetime('now')
WHERE script_key = 'not_interested';

UPDATE messaging_scripts SET
  body = 'Hey [Name] — totally get if it''s not the right time. Mind if I check back in a couple weeks?',
  approved = 1,
  source_reference = 'playbook/follow-ups/email-sequence.md#day-5',
  updated_at = datetime('now')
WHERE script_key = 'follow_up_later';

UPDATE messaging_scripts SET
  body = 'Hey [Name], thanks for getting back to me. Here''s the homepage I put together for [Company]:\n[demo link]\n\nCurious what you think when you get a chance.',
  approved = 1,
  source_reference = 'leadpipeline/AutomatedPipelinePanel.tsx#FollowUpModal.replyLinkText',
  updated_at = datetime('now')
WHERE script_key = 'did_not_receive_link';

UPDATE messaging_scripts SET
  body = NULL,
  approved = 0,
  source_reference = NULL,
  updated_at = datetime('now')
WHERE script_key = 'human_escalation';
