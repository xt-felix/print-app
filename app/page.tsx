import Image from 'next/image';
import { getUser } from '@/lib/auth';
import styles from './page.module.css';

export default async function Home() {
  const { isAuthenticated, userInfo } = await getUser();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Image className={styles.logo} src="/next.svg" alt="Next.js logo" width={100} height={20} priority />

        {/* 用户信息展示 */}
        <div className={styles.intro}>
          {isAuthenticated ? (
            <>
              <h1>Welcome, {userInfo?.name || userInfo?.username || 'User'}!</h1>
              <p>
                Email: {userInfo?.email || 'N/A'}
                <br />
                User ID: {userInfo?.sub}
              </p>
              <div className={styles.ctas}>
                <a className={styles.secondary} href="/api/auth/sign-out">
                  Sign Out
                </a>
              </div>
            </>
          ) : (
            <>
              <h1>Welcome to Print Next</h1>
              <p>Please sign in to continue.</p>
              <div className={styles.ctas}>
                <a className={styles.primary} href="/api/auth/sign-in">
                  Sign In
                </a>
              </div>
            </>
          )}
        </div>

        {/* 原有内容 */}
        <div className={styles.intro}>
          <h2>Getting Started</h2>
          <p>
            Looking for a starting point or more instructions? Head over to{' '}
            <a
              href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              Templates
            </a>{' '}
            or the{' '}
            <a
              href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learning
            </a>{' '}
            center.
          </p>
        </div>

        <div className={styles.ctas}>
          <a
            className={styles.primary}
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image className={styles.logo} src="/vercel.svg" alt="Vercel logomark" width={16} height={16} />
            Deploy Now
          </a>
          <a
            className={styles.secondary}
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
        </div>
      </main>
    </div>
  );
}
