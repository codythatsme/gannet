import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, ExternalLink, GitBranch, Link2, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { AdfView } from '../components/AdfView'
import { Avatar, CycleIcon, PriorityIcon, ProjectIcon, Spinner, StatusGlyph, TeamIcon } from '../components/icons'
import { Menu } from '../components/Menu'
import { Popover, rectOf, type Rect } from '../components/Popover'
import { labelColor } from '../components/IssueList'
import { adfToMarkdown, isEmptyAdf, markdownCompatibility, markdownToAdf } from '../adf/markdown'
import type { HistoryEntry, Issue } from '../domain/types'
import { epicOf, hierarchyOf, isClosed, priorityLevel, statusFor } from '../domain/view'
import { childrenIndex, issueByKey, useData } from '../store/data'
import { fetchIssue, jiraIssueUrl, loadIssueDetail } from '../store/sync'
import { addComment, setDescription, setTitle } from '../store/mutations'
import { openPicker, setUi, useUi, type PickerKind } from '../store/ui'
import { backToList, navigate } from '../app/router'
import { useHotkeys } from '../app/hotkeys'
import { confirmDelete, copyBranch, copyKeys, copyUrl, openCreate, openInJira } from '../app/actions'
import { useTick, useViewCtx } from '../lib/hooks'
import { cx } from '../lib/cx'
import { dueState, formatDate, formatDateTime, relativeTime } from '../lib/time'
import { JiraError } from '../jira/client'

export function IssueDetailView({ issueKey }: { issueKey: string }) {
  const issues = useData((s) => s.issues)
  const issue = issueByKey(issueKey, issues)
  const [missing, setMissing] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setMissing(null)
    let alive = true
    const load = async () => {
      try {
        if (!issueByKey(issueKey)) {
          setLoading(true)
          await fetchIssue(issueKey)
        }
        await loadIssueDetail(issueKey)
      } catch (e) {
        if (alive && !issueByKey(issueKey)) setMissing(e instanceof JiraError && e.status === 404 ? `${issueKey} doesn't exist, or you can't see it.` : String((e as Error).message))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [issueKey])

  if (!issue) {
    return (
      <div className="view center-message">
        {loading ? <Spinner size={18} /> : missing ? <p>{missing}</p> : <Spinner size={18} />}
        {missing && (
          <button className="btn" onClick={backToList}>
            Go back
          </button>
        )}
      </div>
    )
  }
  return <IssueDetail issue={issue} />
}

function IssueDetail({ issue }: { issue: Issue }) {
  useTick(60_000)
  const ctx = useViewCtx()
  const detail = useData((s) => s.details[issue.id])
  const navList = useUi((s) => s.navList)
  const navLabel = useUi((s) => s.navLabel)
  const team = ctx.teams[issue.teamKey]
  const status = statusFor(issue, ctx)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const [moreAt, setMoreAt] = useState<Rect | null>(null)

  useEffect(() => {
    setUi({ focusedId: issue.id, selected: new Set() })
  }, [issue.id])

  const pos = navList.indexOf(issue.id)
  const go = (d: number) => {
    const id = navList[pos + d]
    const next = id ? ctx.issues[id] : undefined
    if (next) navigate({ name: 'issue', key: next.key }, { replace: true })
  }

  useHotkeys({
    escape: () => backToList(),
    j: () => go(1),
    k: () => go(-1),
    arrowdown: () => go(1),
    arrowup: () => go(-1),
    r: () => titleRef.current?.focus(),
    m: () => commentRef.current?.focus(),
    'shift+o': () => openInJira([issue.id]),
  })

  const children = useMemo(() => {
    const list = childrenIndex(ctx.issues).get(issue.id) ?? []
    return [...list].sort((a, b) => Number(isClosed(a, ctx)) - Number(isClosed(b, ctx)) || a.key.localeCompare(b.key, undefined, { numeric: true }))
  }, [ctx, issue.id])
  const isEpicIssue = hierarchyOf(issue, ctx) >= 1
  const parent = issue.parent
  const epic = epicOf(issue, ctx)

  const pick = (kind: PickerKind) => (e: React.MouseEvent) => openPicker(kind, [issue.id], e.currentTarget)

  return (
    <div className="view issue-page">
      <header className="view-header issue-topbar">
        <div className="crumbs">
          <a className="crumb" href={`#/team/${issue.teamKey}/all`}>
            <TeamIcon teamKey={issue.teamKey} team={team} size={16} />
            {team?.name ?? issue.teamKey}
          </a>
          <span className="crumb-sep">›</span>
          <span className="crumb current">{issue.key}</span>
        </div>
        <div className="view-actions">
          {pos >= 0 && (
            <span className="nav-pos" title={navLabel}>
              {pos + 1} / {navList.length}
              <button className="icon-btn" disabled={pos <= 0} onClick={() => go(-1)} title="Previous (K)">
                <ChevronUp size={15} />
              </button>
              <button className="icon-btn" disabled={pos >= navList.length - 1} onClick={() => go(1)} title="Next (J)">
                <ChevronDown size={15} />
              </button>
            </span>
          )}
          <button className="icon-btn" title="Copy issue key (⌘.)" onClick={() => copyKeys([issue.id])}>
            <Copy size={14} />
          </button>
          <button className="icon-btn" title="Copy git branch name (⌘⇧.)" onClick={() => copyBranch([issue.id])}>
            <GitBranch size={14} />
          </button>
          {jiraIssueUrl(issue.key) && (
            <button className="icon-btn" title="Open in Jira (⇧O)" onClick={() => openInJira([issue.id])}>
              <ExternalLink size={14} />
            </button>
          )}
          <button className="icon-btn" title="More" onClick={(e) => setMoreAt(rectOf(e.currentTarget) ?? null)}>
            <MoreHorizontal size={15} />
          </button>
        </div>
      </header>

      <div className="issue-body">
        <main className="issue-main">
          <div className="issue-main-inner">
            {parent && (
              <a className="parent-link" href={`#/issue/${parent.key}`}>
                {parent.hierarchyLevel >= 1 ? <ProjectIcon id={parent.id} size={13} /> : <StatusGlyph status={ctx.issues[parent.id] ? statusFor(ctx.issues[parent.id], ctx) : undefined} size={13} />}
                <span className="muted">{parent.hierarchyLevel >= 1 ? 'Project' : 'Sub-issue of'}</span>
                <span className="parent-key">{parent.key}</span>
                {parent.title}
              </a>
            )}
            <TitleEditor issue={issue} inputRef={titleRef} />
            <DescriptionEditor issueId={issue.id} doc={detail?.description} loading={!detail} />

            {(children.length > 0 || hierarchyOf(issue, ctx) >= 0) && (
              <section className="sub-issues">
                <div className="section-title">
                  <span>{isEpicIssue ? 'Issues' : 'Sub-issues'}</span>
                  {children.length > 0 && (
                    <span className="muted">
                      {children.filter((c) => isClosed(c, ctx)).length}/{children.length}
                    </span>
                  )}
                  <span className="flex" />
                  {isEpicIssue && (
                    <a className="link-btn" href={`#/project/${issue.key}`}>
                      Open project view
                    </a>
                  )}
                  <button
                    className="icon-btn"
                    title={isEpicIssue ? 'Add issue' : 'Add sub-issue'}
                    onClick={() => openCreate({ teamKey: issue.teamKey, parentKey: issue.key, parentTitle: issue.title })}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {children.slice(0, 50).map((c) => (
                  <a key={c.id} className={cx('sub-row', isClosed(c, ctx) && 'closed')} href={`#/issue/${c.key}`}>
                    <PriorityIcon level={priorityLevel(c, ctx)} />
                    <span className="row-key">{c.key}</span>
                    <StatusGlyph status={statusFor(c, ctx)} team={ctx.teams[c.teamKey]} />
                    <span className="row-title">{c.title}</span>
                    <Avatar user={c.assigneeId ? ctx.users[c.assigneeId] : null} size={16} />
                  </a>
                ))}
                {children.length > 50 && <div className="muted small">+{children.length - 50} more in the project view</div>}
              </section>
            )}

            <Activity issue={issue} history={detail?.history ?? []} comments={detail?.comments ?? []} loaded={!!detail} />
            <CommentComposer issueId={issue.id} inputRef={commentRef} />
          </div>
        </main>

        <aside className="issue-sidebar">
          <PropRow label="Status" onClick={pick('status')} hint="S">
            <StatusGlyph status={status} team={team} />
            {status?.name ?? '—'}
          </PropRow>
          <PropRow label="Priority" onClick={pick('priority')} hint="P">
            <PriorityIcon level={priorityLevel(issue, ctx)} />
            {ctx.priorities.find((p) => p.id === issue.priorityId)?.name ?? 'No priority'}
          </PropRow>
          <PropRow label="Assignee" onClick={pick('assignee')} hint="A">
            <Avatar user={issue.assigneeId ? ctx.users[issue.assigneeId] : null} size={18} />
            {issue.assigneeId ? (ctx.users[issue.assigneeId]?.name ?? 'Unknown user') : 'Unassigned'}
          </PropRow>
          <PropRow label="Labels" onClick={pick('labels')} hint="L">
            {issue.labels.length ? (
              <span className="label-wrap">
                {issue.labels.map((l) => (
                  <span key={l} className="chip label-chip">
                    <span className="label-dot" style={{ background: labelColor(l) }} />
                    {l}
                  </span>
                ))}
              </span>
            ) : (
              <span className="muted">Add label</span>
            )}
          </PropRow>
          {team?.sprintsEnabled !== false && (
            <PropRow label="Cycle" onClick={pick('sprint')} hint="⇧C">
              <CycleIcon state={issue.sprintId != null ? ctx.sprints[issue.sprintId]?.state : undefined} />
              {issue.sprintId != null ? (ctx.sprints[issue.sprintId]?.name ?? `Sprint ${issue.sprintId}`) : <span className="muted">No cycle</span>}
            </PropRow>
          )}
          {!isEpicIssue && (
            <PropRow label="Project" onClick={pick('project')} hint="⇧P">
              {epic ? (
                <>
                  <ProjectIcon id={epic.id} />
                  <span className="truncate">{epic.title}</span>
                </>
              ) : (
                <span className="muted">No project</span>
              )}
            </PropRow>
          )}
          <PropRow label="Estimate" onClick={pick('estimate')} hint="E">
            {issue.estimate != null ? `${issue.estimate} points` : <span className="muted">No estimate</span>}
          </PropRow>
          <PropRow label="Due date" onClick={pick('dueDate')} hint="⇧D">
            {issue.dueDate ? <span className={cx('due-text', dueState(issue.dueDate, isClosed(issue, ctx)))}>{formatDate(issue.dueDate, { weekday: 'short', month: 'short', day: 'numeric' })}</span> : <span className="muted">No due date</span>}
          </PropRow>
          <div className="sidebar-sep" />
          <div className="meta-row">
            <span>Type</span>
            <span className="meta-val">
              {ctx.issueTypes[issue.typeId]?.iconUrl && <img src={ctx.issueTypes[issue.typeId].iconUrl} width={14} height={14} alt="" />}
              {ctx.issueTypes[issue.typeId]?.name ?? '—'}
            </span>
          </div>
          <div className="meta-row">
            <span>Reporter</span>
            <span className="meta-val">
              <Avatar user={issue.reporterId ? ctx.users[issue.reporterId] : null} size={16} />
              {issue.reporterId ? ctx.users[issue.reporterId]?.name : '—'}
            </span>
          </div>
          <div className="meta-row">
            <span>Created</span>
            <span className="meta-val" title={formatDateTime(issue.createdAt)}>
              {relativeTime(issue.createdAt)}
            </span>
          </div>
          <div className="meta-row">
            <span>Updated</span>
            <span className="meta-val" title={formatDateTime(issue.updatedAt)}>
              {relativeTime(issue.updatedAt)}
            </span>
          </div>
          {issue.resolvedAt && (
            <div className="meta-row">
              <span>Resolved</span>
              <span className="meta-val" title={formatDateTime(issue.resolvedAt)}>
                {relativeTime(issue.resolvedAt)}
              </span>
            </div>
          )}
        </aside>
      </div>

      {moreAt && (
        <Popover anchor={moreAt} onClose={() => setMoreAt(null)} width={240} align="end">
          <Menu
            placeholder="Actions…"
            items={[
              { id: 'key', label: 'Copy issue key', icon: <Copy size={13} />, hint: '⌘.' },
              { id: 'branch', label: 'Copy git branch name', icon: <GitBranch size={13} />, hint: '⌘⇧.' },
              { id: 'url', label: 'Copy Jira link', icon: <Link2 size={13} /> },
              { id: 'jira', label: 'Open in Jira', icon: <ExternalLink size={13} />, hint: '⇧O' },
              { id: 'refresh', label: 'Reload from Jira', icon: <ChevronDown size={13} /> },
              { id: 'delete', label: 'Delete issue…', icon: <Trash2 size={13} />, hint: '⌘⌫' },
            ]}
            onClose={() => setMoreAt(null)}
            onSelect={(it) => {
              setMoreAt(null)
              if (it.id === 'key') void copyKeys([issue.id])
              if (it.id === 'branch') void copyBranch([issue.id])
              if (it.id === 'url') void copyUrl([issue.id])
              if (it.id === 'jira') openInJira([issue.id])
              if (it.id === 'refresh') void loadIssueDetail(issue.key, true)
              if (it.id === 'delete') confirmDelete([issue.id])
            }}
          />
        </Popover>
      )}
    </div>
  )
}

function PropRow({ label, children, onClick, hint }: { label: string; children: React.ReactNode; onClick: (e: React.MouseEvent) => void; hint?: string }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <button className="prop-value" onClick={onClick} title={hint ? `${label} (${hint})` : label}>
        {children}
      </button>
    </div>
  )
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function TitleEditor({ issue, inputRef }: { issue: Issue; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const [value, setValue] = useState(issue.title)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setValue(issue.title)
  }, [issue.title, editing])
  useEffect(() => autosize(inputRef.current), [value, inputRef])
  const commit = () => {
    setEditing(false)
    if (value.trim() && value.trim() !== issue.title) void setTitle(issue.id, value)
    else setValue(issue.title)
  }
  return (
    <textarea
      ref={inputRef}
      className="title-input"
      value={value}
      rows={1}
      spellCheck={false}
      onFocus={() => setEditing(true)}
      onChange={(e) => setValue(e.target.value.replace(/\n/g, ' '))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setValue(issue.title)
          setEditing(false)
          setTimeout(() => e.currentTarget?.blur?.(), 0)
        }
      }}
    />
  )
}

function DescriptionEditor({ issueId, doc, loading }: { issueId: string; doc: import('../domain/types').AdfDoc | null | undefined; loading: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const compat = useMemo(() => markdownCompatibility(doc ?? null), [doc])
  useEffect(() => setEditing(false), [issueId])
  useEffect(() => autosize(ref.current), [draft, editing])

  const start = () => {
    if (compat.blocking.length) return
    setDraft(adfToMarkdown(doc ?? null))
    setEditing(true)
    setTimeout(() => {
      ref.current?.focus()
      const len = ref.current?.value.length ?? 0
      ref.current?.setSelectionRange(len, len)
    }, 0)
  }
  const save = async () => {
    const before = adfToMarkdown(doc ?? null)
    setEditing(false)
    if (draft.trim() === before.trim()) return
    await setDescription(issueId, draft.trim() ? markdownToAdf(draft) : null)
  }

  if (loading && doc === undefined) return <div className="description muted">Loading…</div>
  if (editing) {
    return (
      <div className="description editing">
        <textarea
          ref={ref}
          className="md-editor"
          value={draft}
          placeholder="Add a description… (Markdown)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void save()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setEditing(false)
            }
          }}
        />
        {compat.lossy.length > 0 && <div className="warn-text">Saving from Markdown will drop: {compat.lossy.join(', ')}.</div>}
        <div className="editor-actions">
          <span className="muted small">Markdown · ⌘↵ to save · Esc to cancel</span>
          <span className="flex" />
          <button className="btn ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className={cx('description', compat.blocking.length === 0 && 'editable')} onClick={(e) => !(e.target as HTMLElement).closest('a,summary,input') && start()}>
      {isEmptyAdf(doc) ? <span className="muted">Add a description…</span> : <AdfView doc={doc} />}
      {compat.blocking.length > 0 && <div className="muted small notice">Contains {compat.blocking.join(', ')}; edit this description in Jira.</div>}
    </div>
  )
}

const FIELD_VERB: Record<string, string> = {
  status: 'changed status',
  priority: 'changed priority',
  labels: 'changed labels',
  summary: 'renamed the issue',
  Sprint: 'changed cycle',
  duedate: 'changed due date',
  issuetype: 'changed type',
  'Story Points': 'changed estimate',
  'Story point estimate': 'changed estimate',
  parent: 'changed parent',
  IssueParentAssociation: 'changed parent',
  'Epic Link': 'changed project',
}

function HistoryLine({ entry, item, ctx }: { entry: HistoryEntry; item: HistoryEntry['items'][number]; ctx: ReturnType<typeof useViewCtx> }) {
  const who = entry.authorId ? (ctx.users[entry.authorId]?.name ?? 'Someone') : 'Jira'
  let text: React.ReactNode
  if (item.field === 'assignee') text = item.to ? <>assigned to <b>{item.to}</b></> : <>removed assignee <b>{item.from}</b></>
  else if (item.field === 'summary') text = <>renamed to <b>{item.to}</b></>
  else
    text = (
      <>
        {FIELD_VERB[item.field] ?? `changed ${item.field}`}
        {item.from ? <> from <b>{item.from}</b></> : null}
        {item.to ? <> to <b>{item.to}</b></> : <> to <b>none</b></>}
      </>
    )
  return (
    <div className="history-line">
      <Avatar user={entry.authorId ? ctx.users[entry.authorId] : null} size={16} />
      <span>
        <b>{who}</b> {text}
      </span>
      <span className="muted" title={formatDateTime(entry.createdAt)}>
        · {relativeTime(entry.createdAt)}
      </span>
    </div>
  )
}

function Activity({ issue, history, comments, loaded }: { issue: Issue; history: HistoryEntry[]; comments: import('../domain/types').Comment[]; loaded: boolean }) {
  const ctx = useViewCtx()
  const items = useMemo(() => {
    const out: ({ kind: 'h'; at: string; entry: HistoryEntry } | { kind: 'c'; at: string; comment: import('../domain/types').Comment } | { kind: 'created'; at: string })[] = [
      { kind: 'created', at: issue.createdAt },
      ...history.map((entry) => ({ kind: 'h' as const, at: entry.createdAt, entry })),
      ...comments.map((comment) => ({ kind: 'c' as const, at: comment.createdAt, comment })),
    ]
    return out.sort((a, b) => a.at.localeCompare(b.at))
  }, [issue.createdAt, history, comments])
  const reporter = issue.reporterId ? ctx.users[issue.reporterId] : undefined
  return (
    <section className="activity">
      <div className="section-title">
        <span>Activity</span>
        {!loaded && <Spinner size={12} />}
      </div>
      {items.map((it) =>
        it.kind === 'created' ? (
          <div key="created" className="history-line">
            <Avatar user={reporter ?? null} size={16} />
            <span>
              <b>{reporter?.name ?? 'Someone'}</b> created the issue
            </span>
            <span className="muted" title={formatDateTime(it.at)}>
              · {relativeTime(it.at)}
            </span>
          </div>
        ) : it.kind === 'h' ? (
          it.entry.items.map((item, i) => <HistoryLine key={`${it.entry.id}-${i}`} entry={it.entry} item={item} ctx={ctx} />)
        ) : (
          <div key={it.comment.id} className="comment">
            <div className="comment-head">
              <Avatar user={it.comment.authorId ? ctx.users[it.comment.authorId] : null} size={20} />
              <b>{it.comment.authorId ? (ctx.users[it.comment.authorId]?.name ?? 'Someone') : 'Someone'}</b>
              <span className="muted" title={formatDateTime(it.comment.createdAt)}>
                {relativeTime(it.comment.createdAt)}
              </span>
            </div>
            <AdfView doc={it.comment.body} className="prose comment-body" />
          </div>
        ),
      )}
    </section>
  )
}

function CommentComposer({ issueId, inputRef }: { issueId: string; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => autosize(inputRef.current), [text, inputRef])
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    const ok = await addComment(issueId, text)
    setBusy(false)
    if (ok) setText('')
  }
  return (
    <div className="composer">
      <textarea
        ref={inputRef}
        value={text}
        placeholder="Leave a comment… (Markdown, ⌘↵ to send)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.blur()
          }
        }}
      />
      <div className="composer-actions">
        <button className="btn primary small" disabled={!text.trim() || busy} onClick={() => void submit()}>
          {busy ? <Spinner size={12} /> : 'Comment'}
        </button>
      </div>
    </div>
  )
}
