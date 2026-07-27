import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';
import { useWorkspaceIds } from '../components/Layout';
import { Badge, Button, Card, ErrorState, Spinner } from '../components/ui';
import { IntelligenceHeader, ContextChip, InsightCallout } from '../components/intelligence';
import { Icon } from '../design/icons';

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
  { q: 'Which materials create the highest working-capital risk?', icon: 'inventory' as const },
  { q: 'Which materials may become obsolete?', icon: 'audit' as const },
  { q: 'Summarize inventory performance for senior management.', icon: 'dashboard' as const },
  { q: 'Which materials have abnormal consumption?', icon: 'consumption' as const },
  { q: 'Create an action plan for the top inventory risks.', icon: 'planning' as const },
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

  const configured = !!status?.configured;
  const scope = [ws.stockDatasetId ? 'stock' : null, ws.movementsDatasetId ? 'movements' : null].filter(Boolean);

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        eyebrow="Governed AI"
        title="AI Insights Center"
        description="Answers are built only from deterministic metrics of the selected datasets and must pass governance checks — evidence, confidence and traceability — before display. The AI never computes figures or fabricates analysis."
        context={<>
          <ContextChip icon="ai" label="Provider"
            value={<span className={configured ? 'text-success' : 'text-warning'}>{configured ? `${status?.provider} · ${status?.model}` : 'disabled'}</span>} />
          <ContextChip icon="database" label="Scope" value={scope.length ? scope.join(' + ') : 'no dataset selected'} />
        </>}
      />

      {status && !configured && (
        <InsightCallout tone="warning" title="No AI provider is configured — this is expected until governance sign-off">
          Set <code className="font-mono text-xs">AI_PROVIDER</code> and the matching API key in the server environment to enable it.
          The platform never fabricates analysis: AI features stay disabled, and the deterministic analytics continue to work fully without them.
        </InsightCallout>
      )}

      <Card title="Ask a question" subtitle="Figures are computed by the analytical engine for the datasets selected in the header — never by the AI">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Suggested analyses</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.q}
              type="button"
              onClick={() => void ask(s.q)}
              disabled={busy}
              className="flex items-start gap-2.5 text-left rounded-lg border border-line bg-bg hover:border-brand hover:bg-brand-soft/40 p-3 text-sm transition-colors disabled:opacity-50"
            >
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand-soft text-link shrink-0"><Icon name={s.icon} size={16} /></span>
              <span className="text-body">{s.q}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-body placeholder:text-subtle"
            placeholder="e.g. Why did inventory value increase this month?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void ask(question); }}
            aria-label="AI question"
          />
          <Button variant="primary" icon="ai" disabled={busy} onClick={() => void ask(question)}>Ask</Button>
        </div>
      </Card>

      {error && <ErrorState message={error} />}
      {busy && <Spinner label="Collecting evidence and consulting the analytical agents…" />}

      <div className="space-y-3">
        {[...turns].reverse().map((turn, i) => (
          turn.role === 'user'
            ? <div key={i} className="flex justify-end"><p className="text-sm font-medium text-on-brand bg-brand rounded-2xl rounded-br-sm px-3.5 py-2 max-w-[80%]">{turn.text}</p></div>
            : (
              <Card key={i} title="Governed response"
                subtitle={turn.response ? `${turn.response.provider} · ${turn.response.model}` : undefined}
                actions={turn.response && <Badge value={turn.response.governance.passed ? 'good' : 'critical'} label={turn.response.governance.passed ? 'governance passed' : 'withheld — governance failed'} />}>
                <p className="text-sm whitespace-pre-wrap text-body">{turn.text}</p>
                {turn.response && turn.response.insights.length > 0 && (
                  <div className="mt-3 space-y-2.5">
                    {turn.response.insights.map((ins, j) => (
                      <div key={j} className="border border-line rounded-lg p-3 text-sm bg-bg">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-body">#{ins.priority}</span>
                          <Badge value={ins.riskLevel} />
                          <Badge value={ins.confidence === 'high' ? 'good' : ins.confidence === 'medium' ? 'medium' : 'low'} label={`confidence: ${ins.confidence}`} />
                          <span className="text-muted text-xs">{ins.suggestedOwner} · {ins.targetTimeframe}</span>
                        </div>
                        <p className="mt-1 font-medium text-body">{ins.finding}</p>
                        <p className="text-muted"><span className="font-medium">Likely cause:</span> {ins.likelyCause}</p>
                        <p className="text-muted"><span className="font-medium">Impact:</span> {ins.businessImpact}</p>
                        <p className="text-body bg-info-soft rounded px-2 py-1 mt-1"><span className="font-medium">Action:</span> {ins.recommendedAction}</p>
                        <details className="mt-1 text-xs text-muted">
                          <summary className="cursor-pointer text-link">Evidence, assumptions &amp; limitations</summary>
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
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer text-link">Governance checks &amp; evidence package</summary>
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
