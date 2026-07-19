import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';
import { useWorkspaceIds } from '../components/Layout';
import { Badge, Card, ErrorState, Spinner } from '../components/ui';

interface Insight {
  finding: string;
  evidence: { metric: string; value: string | number; source: string }[];
  likelyCause: string;
  businessImpact: string;
  riskLevel: string;
  recommendedAction: string;
  priority: number;
  suggestedOwner: string;
  targetTimeframe: string;
  confidence: string;
  assumptions: string[];
  dataLimitations: string[];
}

interface ChatResponse {
  answer: string;
  insights: Insight[];
  evidence: { metric: string; value: string | number; source: string }[];
  governance: { passed: boolean; checks: { name: string; passed: boolean; detail?: string }[] };
  model: string;
  provider: string;
}

interface Turn { role: 'user' | 'ai'; text: string; response?: ChatResponse }

const SUGGESTIONS = [
  'Which materials create the highest working-capital risk?',
  'Which materials may become obsolete?',
  'Summarize inventory performance for senior management.',
  'Which materials have abnormal consumption?',
  'Create an action plan for the top inventory risks.',
];

export function AiCenterPage() {
  const ws = useWorkspaceIds();
  const [status, setStatus] = useState<{ enabled: boolean; configured: boolean; provider: string | null; model: string | null } | null>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<typeof status>('/api/ai/status').then(setStatus).catch(() => setStatus(null));
  }, []);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    setTurns((t) => [...t, { role: 'user', text: q }]);
    setQuestion('');
    try {
      const res = await apiSend<ChatResponse>('POST', '/api/ai/chat', {
        question: q,
        stockDatasetId: ws.stockDatasetId ?? undefined,
        movementsDatasetId: ws.movementsDatasetId ?? undefined,
      });
      setTurns((t) => [...t, { role: 'ai', text: res.answer, response: res }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">AI Insights Center</h1>
      {status && !status.configured && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
          No AI provider is configured. Set <code>AI_PROVIDER</code> and the matching API key in the server environment.
          The platform never fabricates analysis — AI features stay disabled until a provider is configured.
        </p>
      )}
      {status?.configured && (
        <p className="text-xs text-slate-500">
          Provider: {status.provider} · model {status.model}. Every answer is built from deterministic metrics of the
          selected datasets and passes governance checks (evidence, confidence, traceability) before display.
        </p>
      )}

      <Card title="Ask a question" subtitle="Answers use only the selected datasets in the header — figures are computed by the analytical engine, never by the AI">
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} className="text-xs bg-slate-100 hover:bg-slate-200 rounded-full px-3 py-1 text-slate-700">
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. Why did inventory value increase this month?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void ask(question); }}
            aria-label="AI question"
          />
          <button type="button" disabled={busy} onClick={() => void ask(question)} className="bg-sky-700 hover:bg-sky-800 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium">
            Ask
          </button>
        </div>
      </Card>

      {error && <ErrorState message={error} />}
      {busy && <Spinner label="Collecting evidence and consulting the analytical agents…" />}

      <div className="space-y-3">
        {[...turns].reverse().map((turn, i) => (
          turn.role === 'user'
            ? <p key={i} className="text-sm font-medium text-slate-700 bg-slate-200 rounded-lg px-3 py-2 inline-block">{turn.text}</p>
            : (
              <Card key={i} title="AI response" subtitle={turn.response ? `${turn.response.provider} · ${turn.response.model} · governance ${turn.response.governance.passed ? 'passed' : 'FAILED — insights withheld'}` : undefined}>
                <p className="text-sm whitespace-pre-wrap">{turn.text}</p>
                {turn.response && turn.response.insights.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {turn.response.insights.map((ins, j) => (
                      <div key={j} className="border border-slate-200 rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">#{ins.priority}</span>
                          <Badge value={ins.riskLevel} />
                          <Badge value={ins.confidence === 'high' ? 'good' : ins.confidence === 'medium' ? 'medium' : 'low'} label={`confidence: ${ins.confidence}`} />
                          <span className="text-slate-500 text-xs">{ins.suggestedOwner} · {ins.targetTimeframe}</span>
                        </div>
                        <p className="mt-1 font-medium">{ins.finding}</p>
                        <p className="text-slate-600"><span className="font-medium">Likely cause:</span> {ins.likelyCause}</p>
                        <p className="text-slate-600"><span className="font-medium">Impact:</span> {ins.businessImpact}</p>
                        <p className="text-slate-700 bg-sky-50 rounded px-2 py-1 mt-1"><span className="font-medium">Action:</span> {ins.recommendedAction}</p>
                        <details className="mt-1 text-xs text-slate-500">
                          <summary className="cursor-pointer text-sky-700">Evidence, assumptions & limitations</summary>
                          <ul className="list-disc ms-4 mt-1">
                            {ins.evidence.map((e, k) => <li key={k}>{e.metric} = {String(e.value)} (source: {e.source})</li>)}
                            {ins.assumptions.map((a, k) => <li key={`a${k}`}>Assumption: {a}</li>)}
                            {ins.dataLimitations.map((l, k) => <li key={`l${k}`}>Limitation: {l}</li>)}
                          </ul>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
                {turn.response && (
                  <details className="mt-2 text-xs text-slate-500">
                    <summary className="cursor-pointer text-sky-700">Governance checks & evidence package</summary>
                    <ul className="list-disc ms-4 mt-1">
                      {turn.response.governance.checks.map((c) => (
                        <li key={c.name}>{c.passed ? '✓' : '✗'} {c.name}{c.detail ? ` — ${c.detail}` : ''}</li>
                      ))}
                    </ul>
                    <p className="mt-1 font-medium">Metrics supplied to the AI:</p>
                    <ul className="list-disc ms-4">
                      {turn.response.evidence.map((e, k) => <li key={k}>{e.metric} = {String(e.value)} ({e.source})</li>)}
                    </ul>
                  </details>
                )}
              </Card>
            )
        ))}
      </div>
    </div>
  );
}
