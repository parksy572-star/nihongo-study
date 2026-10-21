# 한자 데이터 만들기 (개발용, 사이트에는 결과 JSON만 올라간다)
#
#   python3 -I tools/build_kanji.py <kanjidic2.xml> <kanjivg.xml> <常用漢字一覧.wiki> public/data/kanji
#
# - kanjidic2.xml : https://www.edrdg.org/kanjidic/kanjidic2.xml.gz (EDRDG, CC BY-SA 4.0)
# - kanjivg.xml   : https://github.com/KanjiVG/kanjivg/releases (© Ulrich Apel, CC BY-SA 3.0)
# - 常用漢字一覧.wiki : https://ja.wikipedia.org/wiki/常用漢字一覧 (action=raw, CC BY-SA 4.0)
#   常用漢字表(2010)의 음훈과 대조해 '표외' 읽기를 표시하는 데 쓴다.
#
# 결과: 한자를 코드포인트 % 32 로 나눈 32개 파일(00.json ~ 31.json) + radicals.json + joyo.txt(상용한자 2136자)
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

SHARDS = 32

RADICALS = """一 한 일|丨 뚫을 곤|丶 점 주|丿 삐침 별|乙 새 을|亅 갈고리 궐|二 두 이|亠 돼지해머리 두|人 사람 인|儿 어진사람 인|
入 들 입|八 여덟 팔|冂 멀 경|冖 민갓머리 멱|冫 얼음 빙|几 안석 궤|凵 위튼입구 감|刀 칼 도|力 힘 력|勹 쌀 포|
匕 비수 비|匚 상자 방|匸 감출 혜|十 열 십|卜 점 복|卩 병부 절|厂 굴바위 엄|厶 마늘 모|又 또 우|口 입 구|
囗 에울 위|土 흙 토|士 선비 사|夂 뒤져올 치|夊 천천히걸을 쇠|夕 저녁 석|大 큰 대|女 계집 녀|子 아들 자|宀 집 면|
寸 마디 촌|小 작을 소|尢 절름발이 왕|尸 주검 시|屮 싹날 철|山 메 산|巛 내 천|工 장인 공|己 몸 기|巾 수건 건|
干 방패 간|幺 작을 요|广 집 엄|廴 길게걸을 인|廾 손맞잡을 공|弋 주살 익|弓 활 궁|彐 돼지머리 계|彡 터럭 삼|彳 조금걸을 척|
心 마음 심|戈 창 과|戶 지게 호|手 손 수|支 지탱할 지|攴 칠 복|文 글월 문|斗 말 두|斤 도끼 근|方 모 방|
无 없을 무|日 날 일|曰 가로 왈|月 달 월|木 나무 목|欠 하품 흠|止 그칠 지|歹 뼈앙상할 알|殳 몽둥이 수|毋 말 무|
比 견줄 비|毛 터럭 모|氏 각시 씨|气 기운 기|水 물 수|火 불 화|爪 손톱 조|父 아비 부|爻 점괘 효|爿 나뭇조각 장|
片 조각 편|牙 어금니 아|牛 소 우|犬 개 견|玄 검을 현|玉 구슬 옥|瓜 오이 과|瓦 기와 와|甘 달 감|生 날 생|
用 쓸 용|田 밭 전|疋 발 소|疒 병들 녁|癶 등질 발|白 흰 백|皮 가죽 피|皿 그릇 명|目 눈 목|矛 창 모|
矢 화살 시|石 돌 석|示 보일 시|禸 짐승발자국 유|禾 벼 화|穴 구멍 혈|立 설 립|竹 대 죽|米 쌀 미|糸 실 사|
缶 장군 부|网 그물 망|羊 양 양|羽 깃 우|老 늙을 로|而 말이을 이|耒 쟁기 뢰|耳 귀 이|聿 붓 율|肉 고기 육|
臣 신하 신|自 스스로 자|至 이를 지|臼 절구 구|舌 혀 설|舛 어그러질 천|舟 배 주|艮 그칠 간|色 빛 색|艸 풀 초|
虍 범의문채 호|虫 벌레 충|血 피 혈|行 다닐 행|衣 옷 의|襾 덮을 아|見 볼 견|角 뿔 각|言 말씀 언|谷 골 곡|
豆 콩 두|豕 돼지 시|豸 발없는벌레 치|貝 조개 패|赤 붉을 적|走 달릴 주|足 발 족|身 몸 신|車 수레 거|辛 매울 신|
辰 별 진|辵 쉬엄쉬엄갈 착|邑 고을 읍|酉 닭 유|釆 분별할 변|里 마을 리|金 쇠 금|長 길 장|門 문 문|阜 언덕 부|
隶 미칠 이|隹 새 추|雨 비 우|靑 푸를 청|非 아닐 비|面 낯 면|革 가죽 혁|韋 다룸가죽 위|韭 부추 구|音 소리 음|
頁 머리 혈|風 바람 풍|飛 날 비|食 밥 식|首 머리 수|香 향기 향|馬 말 마|骨 뼈 골|高 높을 고|髟 머리늘어질 표|
鬥 싸울 투|鬯 울창주 창|鬲 솥 력|鬼 귀신 귀|魚 물고기 어|鳥 새 조|鹵 소금밭 로|鹿 사슴 록|麥 보리 맥|麻 삼 마|
黃 누를 황|黍 기장 서|黑 검을 흑|黹 바느질할 치|黽 맹꽁이 맹|鼎 솥 정|鼓 북 고|鼠 쥐 서|鼻 코 비|齊 가지런할 제|
齒 이 치|龍 용 룡|龜 거북 귀|龠 피리 약"""


def norm_reading(r):
    return re.sub(r'[.\-（）()]', '', r)


def parse_joyo(path):
    """常用漢字一覧 위키 문법 표에서 {한자: (구자체, [상용 음훈])}"""
    out = {}
    cell = re.compile(r'\[\[wikt:([^|\]]+)\|')
    with open(path, encoding='utf-8') as f:
        for line in f:
            if not re.match(r'^\|\s*(\{\{0[^}]*\}\})?\d+\s*\|\|', line):
                continue
            cols = [c.strip() for c in line.rstrip('\n').split('||')]
            if len(cols) < 9:
                continue
            m = cell.search(cols[1])
            if not m:
                continue
            ch = m.group(1)
            old = cell.search(cols[2])
            readings_raw = cols[-1]
            readings_raw = re.sub(r'<ref[^>]*>.*?</ref>|<ref[^>]*/>', '', readings_raw)
            readings_raw = re.sub(r'<[^>]+>', '', readings_raw)
            readings_raw = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', readings_raw)
            readings_raw = readings_raw.replace('{{', '').replace('}}', '')
            readings = [r.strip(' 　') for r in re.split(r'[、,]', readings_raw) if r.strip(' 　')]
            out[ch] = (old.group(1) if old else None, readings)
    return out


def parse_kanjidic(path):
    tree = ET.parse(path)
    root = tree.getroot()
    by_jis = {}
    chars = {}
    for c in root.iter('character'):
        lit = c.findtext('literal')
        cps = {cp.get('cp_type'): cp.text for cp in c.iter('cp_value')}
        if 'jis208' in cps:
            by_jis[cps['jis208']] = lit
        misc = c.find('misc')
        rad = None
        for rv in c.iter('rad_value'):
            if rv.get('rad_type') == 'classical':
                rad = int(rv.text)
        e = {
            'c': lit,
            'r': rad,
            'sc': int(misc.findtext('stroke_count')) if misc is not None and misc.findtext('stroke_count') else None,
            'g': int(misc.findtext('grade')) if misc is not None and misc.findtext('grade') else None,
            'j': int(misc.findtext('jlpt')) if misc is not None and misc.findtext('jlpt') else None,
            'f': int(misc.findtext('freq')) if misc is not None and misc.findtext('freq') else None,
            'on': [], 'kun': [], 'ko': [], 'en': [],
            '_var': [v.text for v in misc.iter('variant') if v.get('var_type') == 'jis208'] if misc is not None else [],
        }
        for rd in c.iter('reading'):
            t = rd.get('r_type')
            if t == 'ja_on':
                e['on'].append(rd.text)
            elif t == 'ja_kun':
                e['kun'].append(rd.text)
            elif t == 'korean_h':
                e['ko'].append(rd.text)
        for mn in c.iter('meaning'):
            if mn.get('m_lang') is None:
                e['en'].append(mn.text)
        chars[lit] = e
    for e in chars.values():
        e['v'] = [by_jis[j] for j in e.pop('_var') if j in by_jis]
    return chars


def parse_kanjivg(path):
    """{한자: {'s': [path d...], 'p': [부품 한자...]}}"""
    ns = '{http://kanjivg.tagaini.net}'
    out = {}
    for _, el in ET.iterparse(path, events=('end',)):
        if el.tag != 'kanji':
            continue
        kid = el.get('id', '')
        m = re.match(r'kvg:kanji_([0-9a-f]+)$', kid)
        if not m:
            el.clear()
            continue
        ch = chr(int(m.group(1), 16))
        strokes = []
        for p in el.iter('path'):
            pid = p.get('id', '')
            sm = re.search(r'-s(\d+)$', pid)
            if sm:
                strokes.append((int(sm.group(1)), p.get('d')))
        strokes.sort()
        parts = []
        top = el.find('g')
        if top is not None:
            def walk(g, depth):
                for sub in g.findall('g'):
                    elem = sub.get(ns + 'element')
                    if elem and elem != ch and len(elem) == 1:
                        if elem not in parts:
                            parts.append(elem)
                    elif depth < 2:
                        walk(sub, depth + 1)
            walk(top, 0)
        out[ch] = {'s': [d for _, d in strokes], 'p': parts}
        el.clear()
    return out


def main():
    kd_path, kvg_path, joyo_path, out_dir = sys.argv[1:5]
    joyo = parse_joyo(joyo_path)
    print('常用漢字:', len(joyo))
    kd = parse_kanjidic(kd_path)
    print('KANJIDIC2:', len(kd))
    kvg = parse_kanjivg(kvg_path)
    print('KanjiVG:', len(kvg))

    keep = set(joyo)
    for ch, e in kd.items():
        if e['g'] or e['j'] or e['f']:
            keep.add(ch)
    shards = [{} for _ in range(SHARDS)]
    with_strokes = 0
    for ch in sorted(keep):
        e = kd.get(ch)
        if not e:
            continue
        rec = {'r': e['r'], 'sc': e['sc']}
        if e['g']:
            rec['g'] = e['g']
        if e['j']:
            rec['j'] = e['j']
        if e['f']:
            rec['f'] = e['f']
        variants = list(e['v'])
        if ch in joyo:
            rec['joyo'] = 1
            old, readings = joyo[ch]
            if old and old not in variants:
                variants.insert(0, old)
            official = {norm_reading(r) for r in readings}
            on_std = [r for r in e['on'] if norm_reading(r) in official]
            on_ext = [r for r in e['on'] if norm_reading(r) not in official]
            kun_std = [r for r in e['kun'] if norm_reading(r) in official]
            kun_ext = [r for r in e['kun'] if norm_reading(r) not in official]
            # 상용한자표에만 있는 읽기(KANJIDIC2에 없는 것)도 상용으로 넣는다
            known = {norm_reading(r) for r in e['on'] + e['kun']}
            for r in readings:
                if norm_reading(r) in known:
                    continue
                if re.match(r'^[ァ-ヶー（）()]+$', r):
                    on_std.append(r)
                elif re.match(r'^[ぁ-ゖー\-（）()]+$', r):
                    kun_std.append(r.replace('-', '.'))
            rec['on'] = on_std
            rec['kun'] = kun_std
            if on_ext:
                rec['on2'] = on_ext
            if kun_ext:
                rec['kun2'] = kun_ext
        else:
            rec['on'] = e['on']
            rec['kun'] = e['kun']
        if variants:
            rec['v'] = variants
        if e['ko']:
            rec['ko'] = e['ko']
        if e['en']:
            rec['en'] = e['en'][:4]
        if ch in kvg:
            rec['s'] = kvg[ch]['s']
            if kvg[ch]['p']:
                rec['p'] = kvg[ch]['p']
            with_strokes += 1
        shards[ord(ch) % SHARDS][ch] = rec

    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for i, s in enumerate(shards):
        with open(os.path.join(out_dir, f'{i:02d}.json'), 'w', encoding='utf-8') as f:
            json.dump(s, f, ensure_ascii=False, separators=(',', ':'))
        total += len(s)
    with open(os.path.join(out_dir, 'joyo.txt'), 'w', encoding='utf-8') as f:
        f.write(''.join(sorted(joyo)))
    radicals = []
    for chunk in RADICALS.replace('\n', '').split('|'):
        ch, *name = chunk.strip().split(' ')
        radicals.append([ch, ' '.join(name)])
    assert len(radicals) == 214, len(radicals)
    with open(os.path.join(out_dir, 'radicals.json'), 'w', encoding='utf-8') as f:
        json.dump(radicals, f, ensure_ascii=False, separators=(',', ':'))
    print(f'한자 {total}자 (획순 있음 {with_strokes}자) → {out_dir}')


if __name__ == '__main__':
    main()
