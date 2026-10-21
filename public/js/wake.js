// 면접·분석 중 화면 꺼짐 방지 (Screen Wake Lock: 아이폰 Safari 16.4 이상, 안드로이드 크롬)
// 브라우저는 페이지가 숨겨지면 잠금을 풀기 때문에, 다시 보이면 다시 건다.
// 지원하지 않는 브라우저에서는 아무 일도 하지 않는다.

let sentinel = null;
let holders = 0;

async function acquire() {
  if (!('wakeLock' in navigator) || document.hidden || sentinel) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
    if (holders <= 0) { sentinel.release().catch(() => {}); sentinel = null; }
  } catch {
    sentinel = null; // 배터리 절약 모드 등으로 거절될 수 있다
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && holders > 0) acquire();
});

/** 화면 꺼짐 방지를 켜고, 끄는 함수를 돌려준다(여러 곳에서 겹쳐 써도 된다). */
export function keepAwake() {
  holders++;
  acquire();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holders = Math.max(0, holders - 1);
    if (!holders && sentinel) { sentinel.release().catch(() => {}); sentinel = null; }
  };
}

export const wakeSupported = () => 'wakeLock' in navigator;
