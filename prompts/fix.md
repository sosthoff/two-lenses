You are revising a media-literacy explainer. The attached videos are the original source reports, in this order:
{{sources}}

Goal: {{goal}}

Current explainer data (segment times are "m:ss" into each source video):
{{lens}}

A reviewer watched the rendered explainer and found these issues:
{{issues}}

Fix every error-severity issue and as many warnings as reasonable. Re-watch the sources to find correct timestamps and verbatim quotes. Write times as "m:ss" strings. Keep moments that have no issues unchanged. Keep all rules: notes max 140 characters, segments 6–25 seconds, every outlet in a moment gets a named technique, quotes are verbatim within their segment.

Return only JSON:
{
  "moments": [ …same shape as the input moments… ],
  "questions": ["…"],
  "changes": ["short description of each change you made"]
}
