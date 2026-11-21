// Row update with the render result. Input is either the renderer's callback (Wait node: body = job)
// or the HTTP response when the renderer refused the request (statusCode 4xx/5xx).
const picked = $('Pick next row').first().json;
const input = $input.first().json;
let job;
if (input.statusCode === 202) {
  job = { status: 'failed', id: input.body?.id, error: 'Timed out waiting for the renderer (no callback within 30 min)' };
} else if (input.statusCode !== undefined) {
  job = { status: 'failed', error: input.body?.error || `Renderer answered HTTP ${input.statusCode}` };
} else {
  job = input.body ?? input;
}
const done = job.status === 'done';
const generated = job.images?.generated ?? [];
return [{
  json: {
    row_number: picked.rowNumber,
    Status: done ? 'rendered' : 'failed',
    'Video URL': done ? job.videoUrl : '',
    'Thumbnail URL': done ? job.thumbnailUrl : '',
    'Duration (s)': done ? Math.round(job.duration * 10) / 10 : '',
    'Images generated': generated.join(', '),
    'Rendered at': done ? new Date(job.finishedAt || Date.now()).toISOString().replace('T', ' ').slice(0, 16) : '',
    'Job ID': job.id || '',
    Error: done ? '' : String(job.error || job.status || 'unknown error').slice(0, 500),
  },
}];
