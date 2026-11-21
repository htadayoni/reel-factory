// Row update right after picking: "rendering", or "failed" when the request could not be built.
const picked = $('Pick next row').first().json;
const built = $input.first().json;
return [{
  json: {
    row_number: picked.rowNumber,
    Status: built.ok ? 'rendering' : 'failed',
    Error: built.ok ? '' : built.error,
    'Video URL': '',
    'Thumbnail URL': '',
    'Duration (s)': '',
    'Images generated': '',
    'Rendered at': '',
    'Job ID': '',
  },
}];
