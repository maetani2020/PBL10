// Japanese national holidays used by the calendar views.
// Covers current school-use years with offline calculation, including substitute and bridge holidays.

const holidayCache = new Map();

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function keyFromDate(date) {
  return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function nthMonday(year, month, nth) {
  const first = new Date(year, month - 1, 1);
  const firstMonday = 1 + ((8 - first.getDay()) % 7);
  return firstMonday + (nth - 1) * 7;
}

function springEquinoxDay(year) {
  if (year >= 1980 && year <= 2099) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  return 20;
}

function autumnEquinoxDay(year) {
  if (year >= 1980 && year <= 2099) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  return 23;
}

function addHoliday(map, year, month, day, name, type = "holiday") {
  map.set(dateKey(year, month, day), { name, type });
}

function buildBaseHolidayMap(year) {
  const map = new Map();

  addHoliday(map, year, 1, 1, "元日");
  addHoliday(map, year, 1, nthMonday(year, 1, 2), "成人の日");
  addHoliday(map, year, 2, 11, "建国記念の日");
  addHoliday(map, year, 2, 23, "天皇誕生日");
  addHoliday(map, year, 3, springEquinoxDay(year), "春分の日");
  addHoliday(map, year, 4, 29, "昭和の日");
  addHoliday(map, year, 5, 3, "憲法記念日");
  addHoliday(map, year, 5, 4, "みどりの日");
  addHoliday(map, year, 5, 5, "こどもの日");
  addHoliday(map, year, 7, nthMonday(year, 7, 3), "海の日");
  addHoliday(map, year, 8, 11, "山の日");
  addHoliday(map, year, 9, nthMonday(year, 9, 3), "敬老の日");
  addHoliday(map, year, 9, autumnEquinoxDay(year), "秋分の日");
  addHoliday(map, year, 10, nthMonday(year, 10, 2), "スポーツの日");
  addHoliday(map, year, 11, 3, "文化の日");
  addHoliday(map, year, 11, 23, "勤労感謝の日");

  // Tokyo Olympic special moves.
  if (year === 2020) {
    map.delete(dateKey(year, 7, nthMonday(year, 7, 3)));
    map.delete(dateKey(year, 8, 11));
    map.delete(dateKey(year, 10, nthMonday(year, 10, 2)));
    addHoliday(map, year, 7, 23, "海の日");
    addHoliday(map, year, 7, 24, "スポーツの日");
    addHoliday(map, year, 8, 10, "山の日");
  }

  if (year === 2021) {
    map.delete(dateKey(year, 7, nthMonday(year, 7, 3)));
    map.delete(dateKey(year, 8, 11));
    map.delete(dateKey(year, 10, nthMonday(year, 10, 2)));
    addHoliday(map, year, 7, 22, "海の日");
    addHoliday(map, year, 7, 23, "スポーツの日");
    addHoliday(map, year, 8, 8, "山の日");
  }

  return map;
}

function buildHolidayMap(year) {
  const baseMap = buildBaseHolidayMap(year);
  const map = new Map(baseMap);

  [...baseMap.keys()].sort().forEach((key) => {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getDay() !== 0) return;

    const substitute = new Date(date);
    do {
      substitute.setDate(substitute.getDate() + 1);
    } while (baseMap.has(keyFromDate(substitute)) || map.has(keyFromDate(substitute)));

    if (substitute.getFullYear() === year) {
      map.set(keyFromDate(substitute), { name: "休日", type: "substitute" });
    }
  });

  for (let month = 1; month <= 12; month++) {
    const lastDay = new Date(year, month, 0).getDate();
    for (let day = 2; day < lastDay; day++) {
      const key = dateKey(year, month, day);
      if (map.has(key)) continue;
      const prevKey = dateKey(year, month, day - 1);
      const nextKey = dateKey(year, month, day + 1);
      if (baseMap.has(prevKey) && baseMap.has(nextKey)) {
        map.set(key, { name: "休日", type: "citizen" });
      }
    }
  }

  return map;
}

export function getJapaneseHoliday(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  if (!holidayCache.has(year)) {
    holidayCache.set(year, buildHolidayMap(year));
  }
  return holidayCache.get(year).get(keyFromDate(date)) || null;
}

export function isJapaneseHoliday(date) {
  return Boolean(getJapaneseHoliday(date));
}
