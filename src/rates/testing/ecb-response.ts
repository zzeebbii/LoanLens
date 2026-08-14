/**
 * A verbatim ECB Data Portal response, captured from the live API.
 *
 *   GET https://data-api.ecb.europa.eu/service/data/FM/M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA
 *       ?format=csvdata&startPeriod=2021-01&endPeriod=2021-04
 *
 * Real rather than hand-written, because two properties of the actual response are easy
 * to get wrong from imagination and both break a naive parser:
 *
 *  - Forty columns of metadata, with the observation buried at index 8 and 9. Locating
 *    them by header name is the only thing that keeps this stable.
 *  - `TITLE` and `TITLE_COMPL` are quoted free text *containing commas*. Splitting the
 *    record on commas mangles every row.
 *
 * The values are also genuinely negative — 12M EURIBOR was around −0.50% in early 2021 —
 * which is what a reference floor exists to handle.
 */

const HEADER =
  'KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK,OBS_COM,TIME_FORMAT,BREAKS,COLLECTION,COMPILING_ORG,DISS_ORG,DOM_SER_IDS,FM_CONTRACT_TIME,FM_COUPON_RATE,FM_IDENTIFIER,FM_LOT_SIZE,FM_MATURITY,FM_OUTS_AMOUNT,FM_PUT_CALL,FM_STRIKE_PRICE,PUBL_MU,PUBL_PUBLIC,UNIT_INDEX_BASE,COMPILATION,COVERAGE,DECIMALS,SOURCE_AGENCY,SOURCE_PUB,TITLE,TITLE_COMPL,UNIT,UNIT_MULT'

const TITLE =
  '"Euribor 1-year - Historical close, average of observations through period","Euro area (changing composition) - Money Market - Euribor 1-year - Historical close, average of observations through period - Euro, provided by Refinitiv"'

function row(period: string, value: string): string {
  return `FM.M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA,M,U2,EUR,RT,MM,EURIBOR1YD_,HSTA,${period},${value},A,F,,,P1M,,A,,,EURIBOR1YD=,,,,,,,,,,,,,,7,,,${TITLE},PCPA,0`
}

/** The captured response, unmodified. */
export const ECB_CSV_12M_2021 = [
  HEADER,
  row('2021-01', '-0.5047'),
  row('2021-02', '-0.50085'),
  row('2021-03', '-0.4867391'),
  row('2021-04', '-0.4835'),
  '',
].join('\n')

/** The same shape with an absent observation, which the ECB does emit for some periods. */
export const ECB_CSV_WITH_GAP = [
  HEADER,
  row('2021-01', '-0.5047'),
  row('2021-02', ''),
  row('2021-03', '-0.4867391'),
].join('\n')

/** A response with only a header — a valid request that matched no observations. */
export const ECB_CSV_EMPTY = HEADER

/** Builds a stub `fetch` that returns `body` for any request. */
export function stubFetch(
  body: string,
  init: { status?: number; statusText?: string } = {},
): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      new Response(body, {
        status: init.status ?? 200,
        statusText: init.statusText ?? 'OK',
        headers: { 'content-type': 'text/csv' },
      }),
    )
}

/** Builds a stub `fetch` that records the URLs it was called with. */
export function recordingFetch(body: string): {
  fetch: typeof globalThis.fetch
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    fetch: (input: RequestInfo | URL) => {
      calls.push(String(input))
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } }),
      )
    },
  }
}
