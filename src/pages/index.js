import React, { useState } from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

const copy = {
  en: {
    eyebrow: 'Nano + People',
    h1: 'Nano players.',
    h2: 'Real experience.',
    h3: 'One archive.',
    sub: 'The smallest builders change everything. Nanople is where those who actually run agents share what they learned.',
    cta: 'Browse the archive →',
    s1: 'Articles', s2n: 'Real', s2: 'No demos', s3n: 'Open', s3: 'For all',
    arcLabel: 'Archive',
    mission: 'The nano player is the one running agents alone at 2am. Nanople exists to make sure nothing they learn is lost.',
    footerNote: 'Built by nano players. For everyone.',
    langBtn: 'KO',
  },
  ko: {
    eyebrow: 'Nano + People',
    h1: '나노 플레이어들.',
    h2: '진짜 경험.',
    h3: '하나의 아카이브.',
    sub: '가장 작은 빌더들이 모든 것을 바꾼다. 나노플은 에이전트를 직접 운영하는 사람들이 배운 것을 나누는 곳이다.',
    cta: '아카이브 보기 →',
    s1: '아티클', s2n: '실전', s2: '데모 없음', s3n: '오픈', s3: '모두를 위해',
    arcLabel: '아카이브',
    mission: '나노 플레이어는 새벽 2시에 혼자 에이전트를 돌리는 사람이다. 나노플은 그들이 배운 것이 사라지지 않도록 존재한다.',
    footerNote: '나노 플레이어들이 만든다. 모두를 위해.',
    langBtn: 'EN',
  },
};

const articles = {
  en: [
    { tag: 'Troubleshooting', title: 'The Timeout Misdiagnosis', desc: "Why your agent's silence isn't a timeout problem.", slug: '/docs/troubleshooting/timeout-misdiagnosis' },
    { tag: 'Troubleshooting', title: 'Silent Tool Failure', desc: 'Tools that fail without telling you.', slug: '/docs/troubleshooting/silent-tool-failure' },
    { tag: 'Troubleshooting', title: 'Context Saturation', desc: 'When the agent forgets what it was doing.', slug: '/docs/troubleshooting/context-saturation' },
    { tag: 'Engineering', title: 'Example Drift', desc: 'How few-shot examples go wrong in production.', slug: '/docs/engineering/example-drift' },
    { tag: 'Engineering', title: 'SOUL.md Engineering', desc: 'Designing agent identity that actually holds.', slug: '/docs/engineering/soul-md-engineering' },
  ],
  ko: [
    { tag: '트러블슈팅', title: '타임아웃 오진단', desc: '에이전트가 침묵하는 건 타임아웃 문제가 아닐 수 있다.', slug: '/docs/troubleshooting/timeout-misdiagnosis' },
    { tag: '트러블슈팅', title: '조용한 툴 실패', desc: '에러 없이 실패하는 툴들.', slug: '/docs/troubleshooting/silent-tool-failure' },
    { tag: '트러블슈팅', title: '컨텍스트 포화', desc: '에이전트가 하던 일을 잊어버릴 때.', slug: '/docs/troubleshooting/context-saturation' },
    { tag: '엔지니어링', title: '예시 드리프트', desc: '프로덕션에서 few-shot 예시가 틀어지는 방식.', slug: '/docs/engineering/example-drift' },
    { tag: '엔지니어링', title: 'SOUL.md 엔지니어링', desc: '실제로 작동하는 에이전트 정체성 설계.', slug: '/docs/engineering/soul-md-engineering' },
  ],
};

export default function Home() {
  const [lang, setLang] = useState('en');
  const c = copy[lang];
  const a = articles[lang];

  return (
    <Layout title="Nanople" description="Nano players. Real experience. One archive.">
      <main className={styles.main}>

        <section className={styles.hero}>
          <div className={styles.dots} />
          <p className={styles.eyebrow}>{c.eyebrow}</p>
          <h1 className={styles.headline}>
            <span>{c.h1}</span><br />
            <span className={styles.dim}>{c.h2}</span><br />
            <span>{c.h3}</span>
          </h1>
          <p className={styles.sub}>{c.sub}</p>
          <div className={styles.ctaRow}>
            <Link to="/docs/troubleshooting/timeout-misdiagnosis">
              <button className={styles.cta}>{c.cta}</button>
            </Link>
            <button
              className={styles.langBtn}
              onClick={() => setLang(lang === 'en' ? 'ko' : 'en')}
            >
              {c.langBtn}
            </button>
          </div>
        </section>

        <hr className={styles.divider} />

        <section className={styles.stats}>
          <div><div className={styles.statNum}>5</div><div className={styles.statLabel}>{c.s1}</div></div>
          <div><div className={styles.statNum}>{c.s2n}</div><div className={styles.statLabel}>{c.s2}</div></div>
          <div><div className={styles.statNum}>{c.s3n}</div><div className={styles.statLabel}>{c.s3}</div></div>
        </section>

        <hr className={styles.divider} />

        <section className={styles.articles}>
          <p className={styles.sectionLabel}>{c.arcLabel}</p>
          <div className={styles.grid}>
            {a.map((art, i) => (
              <Link key={i} to={art.slug} className={styles.articleLink}>
                <div className={styles.article}>
                  <p className={styles.articleTag}>{art.tag}</p>
                  <p className={styles.articleTitle}>{art.title}</p>
                  <p className={styles.articleDesc}>{art.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <hr className={styles.divider} />

        <section className={styles.mission}>
          <p className={styles.missionText}>{c.mission}</p>
        </section>

        <hr className={styles.divider} />

        <footer className={styles.footer}>
          <span className={styles.footerLogo}>Nanople</span>
          <span className={styles.footerSep}>·</span>
          <span className={styles.footerCopy}>{c.footerNote}</span>
        </footer>

      </main>
    </Layout>
  );
}
