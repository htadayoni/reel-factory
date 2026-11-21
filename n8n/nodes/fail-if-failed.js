// Mark the execution as failed (so n8n error workflows / notifications fire) after the row was updated.
let result = null;
try {
  result = $('Result fields').first().json;
} catch (e) {
  // "Result fields" did not run: the request could not be built (row already marked failed)
}
if (!result) {
  throw new Error(`Could not build the render request: ${$('Build render request').first().json.error}`);
}
if (result.Status !== 'rendered') throw new Error(`Render failed for row ${result.row_number}: ${result.Error}`);
return [{ json: { ...$('Pick next row').first().json, result } }];
