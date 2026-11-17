import { Fragment, type ReactNode } from 'react'
import type { AdfNode } from '../domain/types'
import { useData } from '../store/data'
import { navigate } from '../app/router'

// Read-only renderer for Atlassian Document Format.

const ISSUE_URL_RE = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/

function Link({ href, children }: { href: string; children: ReactNode }) {
  const m = href.match(ISSUE_URL_RE)
  if (m) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          navigate({ name: 'issue', key: m[1] })
        }}
      >
        {children}
      </a>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  )
}

function Mention({ id, text }: { id: string; text?: string }) {
  const user = useData((s) => s.users[id])
  return <span className="mention">@{(user?.name ?? text ?? 'user').replace(/^@/, '')}</span>
}

function applyMarks(text: ReactNode, marks: AdfNode['marks'] = []): ReactNode {
  let out = text
  for (const m of marks) {
    switch (m.type) {
      case 'strong':
        out = <strong>{out}</strong>
        break
      case 'em':
        out = <em>{out}</em>
        break
      case 'code':
        out = <code>{out}</code>
        break
      case 'strike':
        out = <s>{out}</s>
        break
      case 'underline':
        out = <u>{out}</u>
        break
      case 'subsup':
        out = m.attrs?.type === 'sup' ? <sup>{out}</sup> : <sub>{out}</sub>
        break
      case 'textColor':
        out = <span style={{ color: m.attrs?.color }}>{out}</span>
        break
      case 'link':
        out = <Link href={String(m.attrs?.href ?? '#')}>{out}</Link>
        break
    }
  }
  return out
}

const PANEL_ICON: Record<string, string> = { info: 'ℹ️', note: '📝', warning: '⚠️', error: '⛔', success: '✅', tip: '💡' }

function Node({ n }: { n: AdfNode }): ReactNode {
  const kids = () => n.content?.map((c, i) => <Node key={i} n={c} />)
  switch (n.type) {
    case 'doc':
      return <>{kids()}</>
    case 'paragraph':
      return <p>{kids()}</p>
    case 'text':
      return applyMarks(n.text ?? '', n.marks)
    case 'hardBreak':
      return <br />
    case 'heading': {
      const level = Math.min(6, Math.max(1, n.attrs?.level ?? 1))
      const H = `h${level}` as 'h1'
      return <H>{kids()}</H>
    }
    case 'bulletList':
      return <ul>{kids()}</ul>
    case 'orderedList':
      return <ol start={n.attrs?.order ?? 1}>{kids()}</ol>
    case 'listItem':
      return <li>{kids()}</li>
    case 'taskList':
      return <ul className="task-list">{kids()}</ul>
    case 'taskItem':
      return (
        <li className="task-item">
          <input type="checkbox" checked={n.attrs?.state === 'DONE'} readOnly />
          <span>{kids()}</span>
        </li>
      )
    case 'decisionList':
      return <ul className="task-list">{kids()}</ul>
    case 'decisionItem':
      return <li className="task-item">↳ {kids()}</li>
    case 'codeBlock':
      return (
        <pre>
          <code data-lang={n.attrs?.language}>{n.content?.map((c) => c.text).join('')}</code>
        </pre>
      )
    case 'blockquote':
      return <blockquote>{kids()}</blockquote>
    case 'rule':
      return <hr />
    case 'panel':
      return (
        <div className={`panel panel-${n.attrs?.panelType ?? 'info'}`}>
          <span className="panel-icon">{PANEL_ICON[n.attrs?.panelType] ?? 'ℹ️'}</span>
          <div>{kids()}</div>
        </div>
      )
    case 'expand':
    case 'nestedExpand':
      return (
        <details className="expand">
          <summary>{n.attrs?.title || 'Details'}</summary>
          {kids()}
        </details>
      )
    case 'mention':
      return <Mention id={n.attrs?.id} text={n.attrs?.text} />
    case 'emoji':
      return <span className="emoji">{n.attrs?.text || n.attrs?.shortName}</span>
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard': {
      const url = String(n.attrs?.url ?? '')
      const m = url.match(ISSUE_URL_RE)
      return <Link href={url}>{m ? m[1] : url.replace(/^https?:\/\//, '')}</Link>
    }
    case 'status':
      return <span className={`lozenge lozenge-${n.attrs?.color ?? 'neutral'}`}>{n.attrs?.text}</span>
    case 'date': {
      const ts = Number(n.attrs?.timestamp)
      return <span className="lozenge">{Number.isFinite(ts) ? new Date(ts).toLocaleDateString() : ''}</span>
    }
    case 'table':
      return (
        <div className="table-wrap">
          <table>
            <tbody>{kids()}</tbody>
          </table>
        </div>
      )
    case 'tableRow':
      return <tr>{kids()}</tr>
    case 'tableHeader':
      return <th colSpan={n.attrs?.colspan} rowSpan={n.attrs?.rowspan}>{kids()}</th>
    case 'tableCell':
      return <td colSpan={n.attrs?.colspan} rowSpan={n.attrs?.rowspan}>{kids()}</td>
    case 'mediaSingle':
    case 'mediaGroup':
      return <div className="media-group">{kids()}</div>
    case 'media':
    case 'mediaInline':
      return <span className="media-placeholder">📎 {n.attrs?.alt || 'Attachment'} <em>(open in Jira to view)</em></span>
    case 'layoutSection':
      return <div className="layout-section">{kids()}</div>
    case 'layoutColumn':
      return <div className="layout-column">{kids()}</div>
    case 'extension':
    case 'bodiedExtension':
    case 'inlineExtension':
      return <span className="media-placeholder">Jira macro ({n.attrs?.extensionKey ?? 'extension'})</span>
    default:
      return n.content ? <Fragment>{kids()}</Fragment> : null
  }
}

export function AdfView({ doc, className }: { doc: AdfNode | null | undefined; className?: string }) {
  if (!doc) return null
  return (
    <div className={className ?? 'prose'}>
      <Node n={doc} />
    </div>
  )
}
