'use client';

/**
 * Pretty-printed state viewer. Decodes the wire encoding for Map/Set
 * (`{__type:'Map', entries}`) back into readable object literals first.
 */

function decodeWireCollections(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeWireCollections);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = decodeWireCollections(entry);
  }
  if (record.__type === 'Map' && Array.isArray(record.entries)) {
    return Object.fromEntries(
      record.entries.filter(Array.isArray).map((pair) => [
        String(pair[0]),
        pair[1],
      ]),
    );
  }
  if (record.__type === 'Set' && Array.isArray(record.values)) {
    return record.values;
  }
  return record;
}

export function JsonView({ value }: { value: unknown }) {
  if (value === undefined) {
    return <p className="p-3 text-[12.5px] text-ink-3">No state yet — send a message first.</p>;
  }
  if (value === null) {
    return (
      <p className="p-3 text-[12.5px] text-ink-3 italic">
        This layer holds no stored state (its work happens in lifecycle hooks).
      </p>
    );
  }
  return (
    <pre className="overflow-auto p-3 font-mono text-[11.5px] leading-snug whitespace-pre-wrap text-ink">
      {JSON.stringify(decodeWireCollections(value), null, 2)}
    </pre>
  );
}
