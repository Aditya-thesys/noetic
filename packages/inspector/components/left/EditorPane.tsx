'use client';

/**
 * Monaco editor over the agent file. Cmd/Ctrl+S saves via PUT /api/code —
 * the host's file watcher then hot-reloads the agent child. A failed child
 * boot (syntax/runtime error in the code) surfaces as an overlay with the
 * child's stderr.
 */

import type { Monaco } from '@willbooster/monaco-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { api } from '../../lib/api';
import { useInspector } from '../../lib/store';

const Editor = dynamic(() => import('@willbooster/monaco-react'), {
  ssr: false,
});

/**
 * Give Monaco's in-browser TypeScript service real types: the host serves the
 * workspace packages' `src/*.ts` plus external `.d.ts` deps (`GET /api/types`),
 * and each file is registered as a virtual `node_modules` entry via
 * `addExtraLib`. Module-not-found diagnostics (2307/2792) stay suppressed only
 * until that registration finishes, so imports never flash red on load.
 *
 * `monaco.languages.typescript` is present at runtime (the loader serves the
 * full CDN build, TS worker included) but monaco-editor 0.56's typings
 * replaced the namespace with a `{ deprecated }` stub — hence the schema-
 * validated structural access instead of the typed API.
 */
interface TsDefaults {
  getCompilerOptions(): Record<string, number | boolean | string>;
  setCompilerOptions(options: Record<string, number | boolean | string>): void;
  setDiagnosticsOptions(options: {
    noSemanticValidation: boolean;
    noSyntaxValidation: boolean;
    diagnosticCodesToIgnore: number[];
  }): void;
  addExtraLib(
    content: string,
    filePath?: string,
  ): {
    dispose(): void;
  };
}

const TsDefaultsSchema = z.custom<TsDefaults>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'getCompilerOptions' in value &&
    typeof value.getCompilerOptions === 'function' &&
    'setCompilerOptions' in value &&
    typeof value.setCompilerOptions === 'function' &&
    'setDiagnosticsOptions' in value &&
    typeof value.setDiagnosticsOptions === 'function' &&
    'addExtraLib' in value &&
    typeof value.addExtraLib === 'function',
);

function tsDefaultsOf(monaco: Monaco): TsDefaults | undefined {
  const parsed = z
    .object({
      typescriptDefaults: TsDefaultsSchema,
    })
    .safeParse(monaco.languages.typescript);
  return parsed.success ? parsed.data.typescriptDefaults : undefined;
}

function configureTypescript(monaco: Monaco): void {
  const defaults = tsDefaultsOf(monaco);
  if (defaults === undefined) {
    return;
  }
  defaults.setCompilerOptions({
    ...defaults.getCompilerOptions(),
    // monaco enum values: ScriptTarget.ESNext=99, ModuleKind.ESNext=99,
    // ModuleResolutionKind.NodeJs=2 (typed enums are gone with the namespace).
    target: 99,
    module: 99,
    moduleResolution: 2,
    allowNonTsExtensions: true,
    noEmit: true,
  });
  defaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: [
      2307,
      2792,
    ],
  });
  void loadTypeLibs(defaults);
}

async function loadTypeLibs(defaults: TsDefaults): Promise<void> {
  try {
    const { files } = await api.typeLibs();
    for (const [filePath, content] of Object.entries(files)) {
      defaults.addExtraLib(content, `file:///${filePath}`);
    }
    // Everything importable is now registered — real module errors are signal.
    defaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [],
    });
  } catch (err) {
    // Types are a progressive enhancement; the suppressed-diagnostics mode
    // from configureTypescript stays in effect.
    console.warn('[inspector] type libs unavailable:', err);
  }
}

export function EditorPane() {
  const [source, setSource] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const sourceRef = useRef('');
  const host = useInspector((state) => state.host);

  useEffect(() => {
    void api.code().then((code) => {
      sourceRef.current = code.source;
      setSource(code.source);
    });
  }, []);

  const save = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      await api.saveCode(sourceRef.current);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    save,
  ]);

  if (source === null) {
    return <p className="p-4 text-[13px] text-ink-3">Loading agent code…</p>;
  }

  const bootError = host?.child === 'error' ? host.error : undefined;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1">
        <span className="font-mono text-[11.5px] text-ink-3">.data/agent.ts</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-chip border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors enabled:hover:bg-hover disabled:opacity-40"
        >
          {saving ? 'Saving…' : dirty ? 'Save (⌘S)' : 'Saved'}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          beforeMount={configureTypescript}
          defaultLanguage="typescript"
          defaultPath="file:///agent.ts"
          value={source}
          theme={
            typeof window !== 'undefined' &&
            window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'vs-dark'
              : 'light'
          }
          options={{
            minimap: {
              enabled: false,
            },
            fontSize: 12.5,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
          onChange={(value) => {
            sourceRef.current = value ?? '';
            setDirty(true);
          }}
        />
      </div>
      {bootError && (
        <div className="absolute inset-x-2 bottom-2 rounded-card border border-red/40 bg-red-tint p-3 shadow-overlay">
          <p className="text-[12.5px] font-medium text-red">{bootError.message}</p>
          <pre className="mt-1 max-h-40 overflow-auto font-mono text-[11px] leading-snug whitespace-pre-wrap text-ink-2">
            {bootError.stderrTail}
          </pre>
        </div>
      )}
    </div>
  );
}
