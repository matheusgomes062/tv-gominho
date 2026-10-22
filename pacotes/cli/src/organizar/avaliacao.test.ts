// Measures `organizar`'s questions against the real Jev: file names only, no videos.
// Costs API tokens (~110k per run), so it runs only when asked:
//   npm run avaliar:jev
// Run it after changing questions.ts, classify.ts or the thresholds in plan.ts, and
// compare the summary line with the last one recorded here.
//   2026-10-21: papel 47/47, programa 27/27, marca 9/9; 0 wrong moves, 1 right answer
//   sent to review; 61 requests, 110,995 tokens.
//   2026-10-22: same scores; 3 right answers sent to review. Confidences near the
//   thresholds move a little between runs; what must hold is 0 wrong moves.

import { describe, expect, it } from 'vitest';
import { createJevClient, jevApiKey } from '../jev/client';
import { classifyFiles } from './classify';
import { planOrganize } from './plan';

/** [path, show (null when not an episode), role, station (station clips only)] */
const CASES: [string, string | null, string, string?][] = [
  ['Dragon Ball Z Dublado Completo/DBZ_Episodio 001_WwW.TheRebels.Biz.avi', 'dragon-ball-z', 'episodio'],
  ['Dragon Ball Z Dublado Completo/DBZ 145 - Goku vs Freeza.avi', 'dragon-ball-z', 'episodio'],
  ['Dragon Ball Z Dublado Completo/sample.avi', null, 'extra'],
  ['Dragon Ball Z Dublado Completo/Making of dublagem DBZ.mp4', null, 'extra'],
  ['Dragon Ball Z Dublado Completo/DBZ - Abertura Cha-La Head-Cha-La.mp4', null, 'extra'],
  ['DBGT/Dragon Ball GT - 12 [Dublado].mkv', 'dragon-ball-gt', 'episodio'],
  ['Dragon Ball Classico/DB 001 - O Segredo da Esfera do Dragao.rmvb', 'dragon-ball', 'episodio'],
  ['Bob Esponja Calça Quadrada T01/S01E05 - Ajuda-se Precisa-se.mp4', 'bob-esponja', 'episodio'],
  ['SpongeBob/spongebob 1x07 dublado.avi', 'bob-esponja', 'episodio'],
  ['desenhos/Spectacular Spider-Man 2x03 Dublado.mkv', 'o-espetacular-homem-aranha', 'episodio'],
  ['desenhos/Ultimate Spider-Man S01E10.mp4', 'ultimate-homem-aranha', 'episodio'],
  ['YuGiOh GX/Yu-Gi-Oh GX 045 PT-BR.avi', 'yu-gi-oh-gx', 'episodio'],
  ['Yugioh Duel Monsters/YGO 120.avi', 'yu-gi-oh', 'episodio'],
  ['Padrinhos/Os Padrinhos Magicos - 3x12.avi', 'os-padrinhos-magicos', 'episodio'],
  ['totally spies/Tres Espias Demais 2x05.mkv', 'tres-espias-demais', 'episodio'],
  ['Jackie Chan Adventures/JCA 1x01 The Dark Hand.avi', 'as-aventuras-de-jackie-chan', 'episodio'],
  ['Caverna do Dragao/Caverna do Dragão - 07 - O Vale dos Unicórnios.avi', 'caverna-do-dragao', 'episodio'],
  ['Pica-Pau/Pica Pau 1953 - Episodio 22.avi', 'outro', 'episodio'],
  ['Ben 10/Ben 10 S01E01 Dublado.mp4', 'outro', 'episodio'],
  ['Hamtaro/Hamtaro ep 32.avi', 'hamtaro', 'episodio'],
  ['Digimon 01/Digimon Adventure 01.avi', 'digimon', 'episodio'],
  ['Rugrats/Rugrats S02E04.avi', 'os-anjinhos', 'episodio'],
  ['Novos/A Volta de Goku.avi', 'dragon-ball-z', 'episodio'],
  ['TMNT 2003/Teenage Mutant Ninja Turtles 2003 1x05.avi', 'as-tartarugas-ninja', 'episodio'],
  ['Avatar/Avatar The Last Airbender 1x01 The Boy in the Iceberg.mkv', 'avatar-a-lenda-de-aang', 'episodio'],
  ['Simpsons/The Simpsons S05E02.avi', 'os-simpsons', 'episodio'],
  ['Phineas and Ferb/phineas.and.ferb.s01e01.720p.mkv', 'phineas-e-ferb', 'episodio'],
  // The list says "Spider-Man (série a confirmar)": the 1994 series is a fair match.
  ['Spider-Man 1994/Spider-Man The Animated Series 1x01.avi', 'homem-aranha', 'episodio'],
  ['Pokemon/Pokemon EP 015 - A Batalha da Insignia.avi', 'pokemon', 'episodio'],
  ['Pokemon/Pokémon Abertura Completa Temporada 1.mp4', null, 'extra'],
  ['Pinguins/Os Pinguins de Madagascar 1x03 Dublado.mp4', 'os-pinguins-de-madagascar', 'episodio'],
  ['Filmes/Aladdin 1992 Dublado.mkv', null, 'filme'],
  ['Kim Possible/Kim Possible - So the Drama (filme).avi', null, 'filme'],
  ['vinhetas globinho/Abertura TV Globinho 2004.mp4', null, 'abertura', 'tv-globinho'],
  ['vinhetas globinho/encerramento globinho 2003 (tchau tchau).avi', null, 'encerramento', 'tv-globinho'],
  ['vinhetas globinho/volta ja globinho 2004.avi', null, 'intervalo_entrada', 'tv-globinho'],
  ['vinhetas globinho/TV Globinho - estamos de volta.mp4', null, 'intervalo_saida', 'tv-globinho'],
  ['bumpers/Cartoon Network bumper - já voltamos 2005.mp4', null, 'intervalo_entrada', 'cartoon-network'],
  ['bumpers/CN powerhouse bumper back to the show.mp4', null, 'intervalo_saida', 'cartoon-network'],
  ['bumpers/Jetix bumper.mp4', null, 'intervalo_generico', 'jetix'],
  ['vinhetas/globinho 2010 vinheta.mp4', null, 'intervalo_generico', 'tv-globinho'],
  ['vinhetas/Nick - stay tuned more after the break.mp4', null, 'intervalo_entrada', 'nickelodeon'],
  ['comerciais anos 2000/Comercial Tazos Elma Chips 2001.mp4', null, 'comercial'],
  ['comerciais anos 2000/propaganda Danoninho 1999.avi', null, 'comercial'],
  ['comerciais/Lanche Feliz McDonalds Digimon 2000.mp4', null, 'comercial'],
  ['chamadas/Chamada TV Globinho - Dragon Ball Z amanhã.mp4', null, 'chamada'],
  ['chamadas/Globo chamada Sessão da Tarde - Esqueceram de Mim.mp4', null, 'chamada'],
];

describe.skipIf(!process.env.JEV_AVALIAR)('organizar against the real Jev', () => {
  it('classifies the evaluation set', { timeout: 300_000 }, async () => {
    const jev = await createJevClient({ apiKey: jevApiKey() });
    const files = await classifyFiles(CASES.map(([path]) => path), jev);
    const plan = planOrganize(files, () => false);

    let role = 0, show = 0, shows = 0, brand = 0, brands = 0, wrongMoves = 0, rightButReview = 0;
    const lines: string[] = [];
    files.forEach((file, i) => {
      const [path, wantShow, wantRole, wantBrand] = CASES[i]!;
      const entry = plan.entries[i]!;
      const marks: string[] = [];
      const roleOk = file.role.choice === wantRole;
      if (roleOk) role++;
      else marks.push(`papel ${file.role.choice}≠${wantRole}`);
      let showOk = true;
      if (wantShow) {
        shows++;
        showOk = file.show?.choice === wantShow;
        if (showOk) show++;
        else marks.push(`programa ${file.show?.choice}≠${wantShow}`);
      }
      let brandOk = true;
      if (wantBrand) {
        brands++;
        brandOk = file.brand?.choice === wantBrand;
        if (brandOk) brand++;
        else marks.push(`marca ${file.brand?.choice}≠${wantBrand}`);
      }
      const right = roleOk && showOk && brandOk;
      if (entry.status === 'mover' && !right) wrongMoves++;
      if (entry.status === 'revisar' && right) rightButReview++;
      const conf = `papel ${file.role.confidence.toFixed(2)}${file.show ? ` programa ${file.show.confidence.toFixed(2)}` : ''}${file.brand ? ` marca ${file.brand.confidence.toFixed(2)}` : ''}`;
      lines.push(`${right ? '✓' : '✗'} ${entry.status.padEnd(7)} ${conf.padEnd(42)} ${path} ${marks.join('; ')}`);
    });
    console.log(lines.join('\n'));
    console.log(
      `papel ${role}/${CASES.length}, programa ${show}/${shows}, marca ${brand}/${brands}; ` +
        `${wrongMoves} wrong moves, ${rightButReview} right answers sent to review; ${jev.requests} requests, ${jev.tokens} tokens`,
    );
    // The bar: never move a file to the wrong place.
    expect(wrongMoves).toBe(0);
  });
});
