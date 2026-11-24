import { useStudent } from '../context/StudentContext'
import { InlineTag, SectionHeading } from '../components/ui'
import { competitionStatusLabel } from '../utils/formatters'

export default function ProfilePage() {
  const { state } = useStudent()
  const student = state.student
  const currentLabel = student.currentLevel ? `L${student.currentLevel}` : null
  return <div className="page profile-page"><SectionHeading kicker="Student account" title="My profile." detail="Your sign-up details for this competition." action={<InlineTag tone="lime">Verified profile</InlineTag>} /><section className="profile-sheet"><div className="profile-avatar" aria-hidden="true">{student.name.split(' ').map(part => part[0]).join('').slice(0,2)}</div><div className="profile-name"><h2>{student.name}</h2><span>VVCE student · {student.year}</span></div><dl className="profile-details"><div><dt>Full name</dt><dd>{student.name}</dd></div><div><dt>USN</dt><dd>{student.usn}</dd></div><div><dt>Verified VVCE email</dt><dd>{student.email}<span className="verified-label">Verified</span></dd></div><div><dt>Year of study</dt><dd>{student.year}</dd></div></dl></section><section className="profile-competition" aria-label="Your results"><div><span>Status</span><strong>{competitionStatusLabel(student.competitionStatus)}</strong></div><div><span>Current level</span><strong>{currentLabel || '—'}</strong></div><div><span>Highest level cleared</span><strong>{student.levelsCleared ? `L${student.levelsCleared}` : '—'}</strong></div></section><p className="profile-note">These details cannot be changed here.</p></div>
}
