You are reviewing a rendered media-literacy explainer video. The FIRST attached video is the screen recording of the explainer as a viewer sees it. The following videos are the original source reports, in this order:
{{sources}}

Goal of the explainer: {{goal}}

About the recording: it is silent by design (viewers turn sound on in the live player; the audio is in the source videos, so check what is said there). {{render}}

The explainer was generated from this data (segment times are "m:ss" into each source video):
{{lens}}

Recording timeline (seconds into the recording where each moment starts/ends):
{{marks}}

Automated checks already found these issues (do not repeat them; confirm or add to them):
{{checks}}

Watch the recording and the sources. Judge it against three criteria:
1. grounding: Does each panel show and say what its note claims, at that moment? Is each quote actually said in that segment? Is anything misrepresented or taken out of context?
2. fairness: Is every outlet scrutinized with the same rigor and tone? Would a viewer who likes either outlet feel it was treated fairly?
3. readability: Can a viewer read every note in the time it is on screen? Is any text cut off, overlapping, covering important on-screen information, or appearing at the wrong time? Do the videos actually play (not frozen or black)?

Return only JSON:
{
  "scores": { "grounding": 0.0-1.0, "fairness": 0.0-1.0, "readability": 0.0-1.0 },
  "issues": [
    { "kind": "grounding|fairness|readability", "severity": "error|warn", "momentId": "…|null", "sourceId": "…|null",
      "recordingAt": seconds-or-null, "message": "what is wrong, specifically", "suggestion": "how to fix it" }
  ],
  "summary": "one or two sentences"
}
