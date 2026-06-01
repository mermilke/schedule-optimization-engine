/*
 * KvK Signup & Scheduling - K203
 * v3, April 2026
 * 
 * Handles form submissions, slot assignments, and schedule generation
 * for our 4-week KvK rotation. Noble + Chief Minister dual-track on Day 4.
 *
 * reassignAll() - batch optimize all days
 * reassignDay1/2/4() - single day
 * onFormSubmit() - live assign on new signup
 * manualNewCycle() - reset for next KvK
 */

// config

var CONFIG = {
  SLOTS_PER_TRACK: 49,
  FORM_SHEET: 'Form Responses',
  SCHEDULE_SHEET: 'Schedule',

  DAYS: [
    {
      key: 'day1',
      sheetName: 'Day 1',
      label: 'Day 1: Construction',
      signupCol: 'Do you want to sign up for Day 1: Construction?',
      speedupsCol: 'Day 1 Speedups',
      prefCol: 'Day 1 UTC Preferred Time',
      addCol: 'Day 1 UTC Additional Availability',
      commentsCol: 'Day 1 Comments',
      tracks: 1
    },
    {
      key: 'day2',
      sheetName: 'Day 2',
      label: 'Day 2: Research',
      signupCol: 'Do you want to sign up for Day 2: Research?',
      speedupsCol: 'Day 2 Speedups',
      prefCol: 'Day 2 UTC Preferred Time',
      addCol: 'Day 2 UTC Additional Availability',
      commentsCol: 'Day 2 Comments',
      tracks: 1
    },
    {
      key: 'day4',
      sheetName: 'Day 4',
      label: 'Day 4: Troop Training',
      signupCol: 'Do you want to sign up for Day 4: Troop Training?',
      speedupsCol: 'Day 4 Speedups',
      prefCol: 'Day 4 UTC Preferred Time',
      addCol: 'Day 4 UTC Additional Availability',
      commentsCol: 'Day 4 Comments',
      tracks: 2  // noble + chief minister
    }
  ],

  CROSSOVER: {
    fromDayKey: 'day1',
    toDayKey: 'day2',
    fromSlot: '23:45',
    toSlot: '00:00'
  },

  // column layout for day sheets (noble advisor side)
  // A=Name, B=Override, C=Start, D=End, E=Timestamp, F=ID, G=Alliance, H=Speedups, I=Pref, J=Alt, K=Comments
  COL: {
    name: 1, override: 2, start: 3, end: 4, timestamp: 5,
    id: 6, alliance: 7, speedups: 8, pref: 9, alt: 10, comments: 11
  },

  // chief minister columns on Day 4 (M through W)
  CM_COL: {
    name: 13, override: 14, start: 15, end: 16, timestamp: 17,
    id: 18, alliance: 19, speedups: 20, pref: 21, alt: 22, comments: 23
  }
};


// time slots
// 49 slots from 00:00 (which is actually 23:45 day-start) through 23:45 (day-end)
// Form uses "00:00 – 00:15" for day-start to avoid the duplicate 23:45 confusion

var ALL_SLOTS = [
  '00:00',
  '00:15','00:45','01:15','01:45','02:15','02:45','03:15',
  '03:45','04:15','04:45','05:15','05:45','06:15','06:45','07:15',
  '07:45','08:15','08:45','09:15','09:45','10:15','10:45','11:15',
  '11:45','12:15','12:45','13:15','13:45','14:15','14:45','15:15',
  '15:45','16:15','16:45','17:15','17:45','18:15','18:45','19:15',
  '19:45','20:15','20:45','21:15','21:45','22:15','22:45','23:15',
  '23:45'
];

// end time for each slot
var END_TIMES = {};
(function() {
  var ends = [
    '00:15','00:45','01:15','01:45','02:15','02:45','03:15','03:45',
    '04:15','04:45','05:15','05:45','06:15','06:45','07:15','07:45',
    '08:15','08:45','09:15','09:45','10:15','10:45','11:15','11:45',
    '12:15','12:45','13:15','13:45','14:15','14:45','15:15','15:45',
    '16:15','16:45','17:15','17:45','18:15','18:45','19:15','19:45',
    '20:15','20:45','21:15','21:45','22:15','22:45','23:15','23:45',
    '00:00'
  ];
  ALL_SLOTS.forEach(function(s, i) { END_TIMES[s] = ends[i]; });
})();

// 00:00 displays as 23:45* on the sheet (the asterisk = day-start crossover slot)
function displayTime(slot) {
  if (slot === '00:00') return '23:45*';
  return slot;
}


// helpers

// pull start time out of form strings like "12:15 – 12:45"
function extractStart(str) {
  if (!str) return '';
  var m = String(str).trim().match(/^(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

// parse comma-separated availability into array of valid slot times
function parseAvail(text) {
  if (!text) return [];
  return String(text).split(',')
    .map(function(s) { return extractStart(s.trim()); })
    .filter(function(t) { return t.length === 5 && ALL_SLOTS.indexOf(t) >= 0; });
}

// normalize whatever getValue() returns into "HH:MM"
// google sheets tables love turning "09:45" into a Date object...
function normalizeTime(val) {
  if (!val) return null;

  // Date object from typed column
  if (val instanceof Date || (typeof val === 'object' && val.getHours)) {
    var h = String(val.getHours()).padStart(2, '0');
    var m = String(val.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  var s = String(val).trim();
  if (s === '23:45*') return '00:00';  // display label -> internal key
  if (s.length > 5 && s[2] === ':') return s.substring(0, 5);  // "00:15:00" -> "00:15"
  if (s.length === 5 && s[2] === ':') return s;

  // last resort: pull HH:MM out of a long date string
  var match = s.match(/(\d{2}):(\d{2}):\d{2}/);
  if (match) return match[1] + ':' + match[2];

  return s.length >= 4 ? s : null;
}

function colMap(headers) {
  var idx = {};
  headers.forEach(function(h, i) { if (h) idx[String(h).trim()] = i; });
  return idx;
}

function timeToMin(t) {
  if (!t || t.length < 5) return null;
  var p = t.split(':').map(Number);
  return (isNaN(p[0]) || isNaN(p[1])) ? null : p[0] * 60 + p[1];
}

// circular distance (handles midnight wrap)
function timeDist(a, b) {
  var ma = timeToMin(a), mb = timeToMin(b);
  if (ma === null || mb === null) return Infinity;
  var d = Math.abs(ma - mb);
  return Math.min(d, 1440 - d);
}

// safe formatting wrappers -- tables throw if you try to change typed column formats
function safeBg(range, color) { try { range.setBackground(color); } catch(e) {} }
function safeBold(range, w) { try { range.setFontWeight(w); } catch(e) {} }
function safeColor(range, c) { try { range.setFontColor(c); } catch(e) {} }
function safeItalic(range, s) { try { range.setFontStyle(s); } catch(e) {} }
function safeClear(range) { try { range.clearFormat(); } catch(e) {} }

function setCellText(sheet, r, c, val) {
  sheet.getRange(r, c).setValue(String(val || ''));
}

// find first row where column is empty (for tables with pre-existing empty rows)
function firstEmptyRow(sheet, col) {
  var last = sheet.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (!String(sheet.getRange(r, col).getValue() || '').trim()) return r;
  }
  return last + 1;
}


// form data reader
// De-duplicates by player name. If someone resubmits just one day,
// their other days stay as-is. Full resubmission replaces everything.

function readFormData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.FORM_SHEET);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = data[0].map(function(h) { return h ? String(h).trim() : ''; });
  var ci = colMap(headers);

  function val(row, col) {
    var i = ci[col];
    return (i !== undefined) ? row[i] : '';
  }

  var players = new Map();

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var name = String(val(row, 'Player Name') || '').trim();
    if (!name) continue;

    var existing = players.get(name) || {
      name: name,
      id: val(row, 'Player ID'),
      timestamp: val(row, 'Timestamp'),
      alliance: val(row, 'Alliance'),
      days: {}
    };

    // always take latest metadata
    existing.id = val(row, 'Player ID') || existing.id;
    existing.timestamp = val(row, 'Timestamp') || existing.timestamp;
    existing.alliance = val(row, 'Alliance') || existing.alliance;

    CONFIG.DAYS.forEach(function(dc) {
      var signed = String(val(row, dc.signupCol) || '').trim();

      if (signed === 'Yes') {
        var prefRaw = String(val(row, dc.prefCol) || '');
        var addRaw = String(val(row, dc.addCol) || '');
        var spd = Number(val(row, dc.speedupsCol)) || 0;
        var cmt = String(val(row, dc.commentsCol) || '');
        var pref = extractStart(prefRaw);
        var adds = parseAvail(addRaw);
        var all = [pref].concat(adds).filter(function(t) { return t.length === 5; });
        // dedupe
        var seen = {};
        all = all.filter(function(t) { return seen[t] ? false : (seen[t] = true); });

        existing.days[dc.key] = {
          signedUp: true, speedups: spd, preferred: pref,
          additional: adds, allAvail: all, comments: cmt,
          prefRaw: prefRaw, addRaw: addRaw
        };
      } else if (signed === 'No') {
        existing.days[dc.key] = { signedUp: false };
      }
      // blank = keep whatever was there (partial resubmission)
    });

    players.set(name, existing);
  }

  return Array.from(players.values());
}


// override reading
// Reads column B from Day sheets. Handles typed columns that turn "09:45" into Date objects.

function readOverrides(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  var overrides = new Map();
  if (!sheet) return overrides;

  var C = CONFIG.COL;
  var last = sheet.getLastRow();
  if (last < 2) return overrides;

  for (var r = 2; r <= last; r++) {
    var name = String(sheet.getRange(r, C.name).getValue() || '').trim();
    var raw = sheet.getRange(r, C.override).getValue();
    if (!name || !raw) continue;
    if (name.indexOf('──') === 0 || name.indexOf('⚠') === 0 || name === 'Player Name') continue;

    var str = String(raw).trim().toUpperCase();
    if (str === 'SKIP' || str === 'ASSIGN' || str === 'CHIEF' || str === 'NOBLE') {
      overrides.set(name, str);
    } else {
      var t = normalizeTime(raw);
      if (t && ALL_SLOTS.indexOf(t) >= 0) {
        overrides.set(name, t);
      } else {
        overrides.set(name, String(raw).trim());
      }
    }
  }
  return overrides;
}

// same thing but for chief minister columns (N = col 14)
// TODO: could probably merge this with readOverrides and just pass the column numbers
function readCMOverrides(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  var overrides = new Map();
  if (!sheet) return overrides;

  var last = sheet.getLastRow();
  if (last < 2) return overrides;

  for (var r = 2; r <= last; r++) {
    var name = String(sheet.getRange(r, CONFIG.CM_COL.name).getValue() || '').trim();
    var raw = sheet.getRange(r, CONFIG.CM_COL.override).getValue();
    if (!name || !raw) continue;
    if (name.indexOf('──') === 0 || name.indexOf('⚠') === 0 || name === 'Player Name') continue;

    var str = String(raw).trim().toUpperCase();
    if (str === 'SKIP' || str === 'ASSIGN' || str === 'CHIEF' || str === 'NOBLE') {
      overrides.set(name, str);
    } else {
      var t = normalizeTime(raw);
      if (t && ALL_SLOTS.indexOf(t) >= 0) {
        overrides.set(name, t);
      } else {
        overrides.set(name, String(raw).trim());
      }
    }
  }
  return overrides;
}


// assignment algorithm
// 
// The main optimization. Works in phases:
//   1) Select top N by speedups
//   2) Assign most-constrained first (fewest available slots)
//   3) Bump/swap: if a top player couldn't fit, displace the lowest-speedup
//      player in one of their available slots
//   4) Backfill leftover open slots with remaining players
//
// SKIP'd players bypass all of this and go straight to unassigned.

function assignToTrack(players, maxSlots, reserved, reservedFor) {
  reserved = reserved || new Set();
  reservedFor = reservedFor || '';

  var assigned = [];
  var taken = new Set(reserved);

  // skipped players go to unassigned immediately
  var skipped = players.filter(function(p) { return p.isSkipped; });
  var active = players.filter(function(p) { return !p.isSkipped; });

  // crossover player gets their reserved slot (this is the day1->day2 bridge person)
  if (reservedFor) {
    var crossPlayer = active.find(function(p) { return p.name === reservedFor; });
    if (crossPlayer) {
      reserved.forEach(function(s) {
        assigned.push({ player: crossPlayer, slot: s, locked: true });
      });
    }
  }

  // locked players (time override) go in first, no questions asked
  var locked = active.filter(function(p) { return p.lockedSlot && p.name !== reservedFor; });
  var rest = active.filter(function(p) { return !p.lockedSlot && p.name !== reservedFor; });

  locked.forEach(function(p) {
    if (taken.has(p.lockedSlot)) {
      Logger.log('WARNING: slot conflict for ' + p.name + ' at ' + p.lockedSlot);
    }
    taken.add(p.lockedSlot);
    assigned.push({ player: p, slot: p.lockedSlot, locked: true });
  });

  // step 1: pick top players by speedups
  // ASSIGN override players always make the cut
  var mustAssign = rest.filter(function(p) { return p.mustAssign; });
  var normal = rest.filter(function(p) { return !p.mustAssign; });
  normal.sort(function(a, b) { return b.speedups - a.speedups; });

  var available = maxSlots - assigned.length;
  var normalCut = Math.max(0, available - mustAssign.length);
  var selected = mustAssign.concat(normal.slice(0, normalCut));
  var notSelected = normal.slice(normalCut);

  // step 2: assign selected, most-constrained first
  // (prevents flexible players from hogging scarce slots)
  var constrained = selected.slice().sort(function(a, b) {
    var diff = a.allAvail.length - b.allAvail.length;
    return diff !== 0 ? diff : b.speedups - a.speedups;
  });

  var unplaced = [];

  constrained.forEach(function(player) {
    var pref = player.preferred;
    var cands = player.allAvail.slice().sort(function(a, b) {
      if (a === pref) return -1;
      if (b === pref) return 1;
      return timeDist(a, pref) - timeDist(b, pref);
    });

    var slot = null;
    for (var i = 0; i < cands.length; i++) {
      if (!taken.has(cands[i])) { slot = cands[i]; break; }
    }

    if (slot) {
      taken.add(slot);
      assigned.push({ player: player, slot: slot });
    } else {
      unplaced.push(player);
    }
  });

  // step 3: bump/swap for unplaced top players
  unplaced.sort(function(a, b) { return b.speedups - a.speedups; });
  var bumped = [];

  unplaced.forEach(function(up) {
    // find lowest-speedup assigned player sitting in one of our slots
    var victims = assigned
      .filter(function(a) {
        if (a.player.name === reservedFor) return false;
        if (a.locked) return false;
        return up.allAvail.indexOf(a.slot) >= 0;
      })
      .sort(function(a, b) { return a.player.speedups - b.player.speedups; });

    if (victims.length === 0) return;
    var victim = victims[0];
    if (up.speedups <= victim.player.speedups) return;

    // try to relocate the victim first
    var victimAlts = victim.player.allAvail
      .filter(function(s) { return !taken.has(s); })
      .sort(function(a, b) {
        return timeDist(a, victim.player.preferred) - timeDist(b, victim.player.preferred);
      });

    if (victimAlts.length > 0) {
      // victim relocates, nobody loses a spot
      var freedSlot = victim.slot;
      taken.delete(freedSlot);
      taken.add(victimAlts[0]);
      victim.slot = victimAlts[0];

      var bestSlot = freedSlot;
      if (up.preferred !== bestSlot && up.allAvail.indexOf(up.preferred) >= 0 && !taken.has(up.preferred)) {
        bestSlot = up.preferred;
      }
      taken.add(bestSlot);
      assigned.push({ player: up, slot: bestSlot });
    } else {
      // victim has nowhere to go, bump them
      var freed = victim.slot;
      assigned.splice(assigned.indexOf(victim), 1);
      taken.delete(freed);
      bumped.push(victim.player);

      var cands2 = up.allAvail
        .filter(function(s) { return !taken.has(s); })
        .sort(function(a, b) {
          if (a === up.preferred) return -1;
          if (b === up.preferred) return 1;
          return timeDist(a, up.preferred) - timeDist(b, up.preferred);
        });

      if (cands2.length > 0) {
        taken.add(cands2[0]);
        assigned.push({ player: up, slot: cands2[0] });
      }
    }
  });

  // step 4: backfill open slots with remaining players
  var leftover = notSelected.concat(bumped).sort(function(a, b) { return b.speedups - a.speedups; });

  leftover.forEach(function(player) {
    if (assigned.length >= maxSlots) return;
    var pref = player.preferred;
    var cands = player.allAvail
      .filter(function(s) { return !taken.has(s); })
      .sort(function(a, b) {
        if (a === pref) return -1;
        if (b === pref) return 1;
        return timeDist(a, pref) - timeDist(b, pref);
      });

    if (cands.length > 0) {
      taken.add(cands[0]);
      assigned.push({ player: player, slot: cands[0] });
    }
  });

  // build unassigned list
  var assignedNames = {};
  assigned.forEach(function(a) { assignedNames[a.player.name] = true; });

  var unassigned = players
    .filter(function(p) { return !assignedNames[p.name]; })
    .map(function(p) {
      var reason = p.isSkipped ? 'SKIPPED (manual override)'
        : 'All preferred/alternate slots taken';
      return { player: p, reason: reason };
    });

  unassigned.sort(function(a, b) { return b.player.speedups - a.player.speedups; });

  return { assigned: assigned, unassigned: unassigned };
}


// batch assign

function batchAssignDay(dayConfig, allPlayers, crossover) {
  var overrides = readOverrides(dayConfig.sheetName);
  var cmOverrides = new Map();
  if (dayConfig.tracks === 2) {
    cmOverrides = readCMOverrides(dayConfig.sheetName);
  }

  var eligible = allPlayers
    .filter(function(p) {
      return p.days[dayConfig.key] && p.days[dayConfig.key].signedUp;
    })
    .map(function(p) {
      var d = p.days[dayConfig.key];
      var ov = (overrides.get(p.name) || '').toUpperCase();
      var cmOv = (cmOverrides.get(p.name) || '').toUpperCase();

      var forcedTrack = null;
      if (ov === 'CHIEF' || cmOv === 'CHIEF') forcedTrack = 'chief';
      if (ov === 'NOBLE' || cmOv === 'NOBLE') forcedTrack = 'noble';

      var lockedSlot = null;
      var ovTime = ov.length === 5 && ALL_SLOTS.indexOf(ov) >= 0 ? ov : null;
      var cmOvTime = cmOv.length === 5 && ALL_SLOTS.indexOf(cmOv) >= 0 ? cmOv : null;
      if (ovTime) lockedSlot = ovTime;
      if (cmOvTime) { lockedSlot = cmOvTime; forcedTrack = 'chief'; }

      var isSkipped = (ov === 'SKIP' || cmOv === 'SKIP');
      var mustAssign = !isSkipped && (ov === 'ASSIGN' || cmOv === 'ASSIGN');
      var rawOverride = overrides.get(p.name) || cmOverrides.get(p.name) || '';

      return {
        name: p.name, id: p.id, alliance: p.alliance, timestamp: p.timestamp,
        speedups: d.speedups, preferred: d.preferred, allAvail: d.allAvail,
        comments: d.comments, prefRaw: d.prefRaw, addRaw: d.addRaw,
        lockedSlot: isSkipped ? null : lockedSlot,
        mustAssign: mustAssign, forcedTrack: forcedTrack,
        isSkipped: isSkipped, override: rawOverride
      };
    });

  // crossover handling
  var reservedSlots = new Set();
  var reservedFor = '';

  if (crossover && crossover.playerName) {
    reservedSlots.add(crossover.reservedSlot);
    reservedFor = crossover.playerName;

    if (!eligible.find(function(p) { return p.name === crossover.playerName; })) {
      var pd = allPlayers.find(function(p) { return p.name === crossover.playerName; });
      if (pd && pd.days[dayConfig.key] && pd.days[dayConfig.key].signedUp) {
        var dd = pd.days[dayConfig.key];
        eligible.push({
          name: pd.name, id: pd.id, alliance: pd.alliance, timestamp: pd.timestamp,
          speedups: dd.speedups, preferred: dd.preferred, allAvail: dd.allAvail,
          comments: dd.comments, prefRaw: dd.prefRaw, addRaw: dd.addRaw,
          lockedSlot: null, mustAssign: false, forcedTrack: null,
          isSkipped: false, override: ''
        });
      }
    }
  }

  if (dayConfig.tracks === 1) {
    var result = assignToTrack(eligible, CONFIG.SLOTS_PER_TRACK, reservedSlots, reservedFor);
    return { track1: result.assigned, track2: [], unassigned: result.unassigned };
  }

  // dual track: split by forced track, then noble first, overflow to chief
  var forceNoble = eligible.filter(function(p) { return p.forcedTrack === 'noble'; });
  var forceChief = eligible.filter(function(p) { return p.forcedTrack === 'chief'; });
  var auto = eligible.filter(function(p) { return !p.forcedTrack; });

  var t1 = assignToTrack(forceNoble.concat(auto), CONFIG.SLOTS_PER_TRACK, reservedSlots, reservedFor);
  var overflow = t1.unassigned.map(function(u) { return u.player; })
    .filter(function(p) { return !p.isSkipped; }); // don't re-add skipped
  var t2 = assignToTrack(forceChief.concat(overflow), CONFIG.SLOTS_PER_TRACK);

  // merge skipped players into final unassigned
  var skippedFromT1 = t1.unassigned.filter(function(u) { return u.player.isSkipped; });

  return {
    track1: t1.assigned,
    track2: t2.assigned,
    unassigned: t2.unassigned.concat(skippedFromT1)
  };
}


// crossover (day 1 last slot -> day 2 first slot)

function findCrossover(day1Results, allPlayers) {
  var cross = CONFIG.CROSSOVER;
  var lastSlotEntry = day1Results.track1.find(function(e) { return e.slot === cross.fromSlot; });
  if (!lastSlotEntry) return null;

  var name = lastSlotEntry.player.name;
  var pd = allPlayers.find(function(p) { return p.name === name; });
  if (!pd || !pd.days[cross.toDayKey] || !pd.days[cross.toDayKey].signedUp) return null;

  return { playerName: name, reservedSlot: cross.toSlot };
}


// write day sheet

function writeTrack(sheet, startRow, assignments) {
  var C = CONFIG.COL;
  var cols = 11;
  var slotMap = {};
  assignments.forEach(function(e) { slotMap[e.slot] = e; });

  var row = startRow;
  ALL_SLOTS.forEach(function(slot) {
    var entry = slotMap[slot];
    var endTime = END_TIMES[slot] || '';
    var dt = displayTime(slot);

    if (entry) {
      var p = entry.player;
      sheet.getRange(row, C.name).setValue(p.name);
      if (p.override) sheet.getRange(row, C.override).setValue(p.override);
      setCellText(sheet, row, C.start, dt);
      setCellText(sheet, row, C.end, endTime);
      sheet.getRange(row, C.timestamp).setValue(p.timestamp);
      sheet.getRange(row, C.id).setValue(p.id);
      sheet.getRange(row, C.alliance).setValue(p.alliance);
      sheet.getRange(row, C.speedups).setValue(p.speedups);
      setCellText(sheet, row, C.pref, p.prefRaw || p.preferred);
      setCellText(sheet, row, C.alt, p.addRaw || p.allAvail.join(', '));
      sheet.getRange(row, C.comments).setValue(p.comments || '');
    } else {
      sheet.getRange(row, C.name).setValue('── OPEN ──');
      setCellText(sheet, row, C.start, dt);
      setCellText(sheet, row, C.end, endTime);
      safeBg(sheet.getRange(row, 1, 1, cols), '#b7e1cd');
      safeColor(sheet.getRange(row, 1, 1, cols), '#0b6623');
      safeItalic(sheet.getRange(row, 1, 1, cols), 'italic');
    }
    row++;
  });

  return row;
}

function writeUnassigned(sheet, startRow, entries) {
  if (entries.length === 0) return startRow;

  var C = CONFIG.COL;
  var cols = 11;
  var row = startRow + 1;

  sheet.getRange(row, 1).setValue('⚠ UNASSIGNED PLAYERS – Contact for new availability');
  safeBold(sheet.getRange(row, 1, 1, cols), 'bold');
  safeBg(sheet.getRange(row, 1, 1, cols), '#f4cccc');
  safeColor(sheet.getRange(row, 1, 1, cols), '#990000');
  row++;

  // headers
  sheet.getRange(row, C.name).setValue('Player Name');
  sheet.getRange(row, C.override).setValue('Override');
  sheet.getRange(row, C.id).setValue('Player ID');
  sheet.getRange(row, C.alliance).setValue('Alliance');
  sheet.getRange(row, C.speedups).setValue('Speedups');
  sheet.getRange(row, C.pref).setValue('Preferred Time');
  sheet.getRange(row, C.alt).setValue('Additional Availability');
  sheet.getRange(row, C.comments).setValue('Reason');
  safeBold(sheet.getRange(row, 1, 1, cols), 'bold');
  safeBg(sheet.getRange(row, 1, 1, cols), '#f4cccc');
  safeColor(sheet.getRange(row, 1, 1, cols), '#990000');
  row++;

  entries.sort(function(a, b) { return b.player.speedups - a.player.speedups; });

  entries.forEach(function(entry) {
    var p = entry.player;
    sheet.getRange(row, C.name).setValue(p.name);
    if (p.override) sheet.getRange(row, C.override).setValue(p.override);
    sheet.getRange(row, C.id).setValue(p.id);
    sheet.getRange(row, C.alliance).setValue(p.alliance);
    sheet.getRange(row, C.speedups).setValue(p.speedups);
    setCellText(sheet, row, C.pref, p.prefRaw || p.preferred);
    setCellText(sheet, row, C.alt, p.addRaw || p.allAvail.join(', '));
    sheet.getRange(row, C.comments).setValue(entry.reason);
    safeBg(sheet.getRange(row, 1, 1, cols), '#fce5cd');
    row++;
  });

  return row;
}

function writeDaySheet(dayConfig, results) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(dayConfig.sheetName);
  if (!sheet) return;

  var C = CONFIG.COL;
  var last = Math.max(sheet.getLastRow(), 60);

  // clear noble advisor side
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 11).clearContent();
    safeClear(sheet.getRange(2, 1, last - 1, 11));
  }

  // wrap text on availability + comments
  var maxR = Math.max(sheet.getMaxRows(), 200);
  try {
    sheet.getRange(1, C.alt, maxR, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    sheet.getRange(1, C.comments, maxR, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  } catch(e) {}

  // center C through J
  try {
    for (var c = 3; c <= 10; c++) {
      sheet.getRange(2, c, maxR, 1).setHorizontalAlignment('center');
    }
  } catch(e) {}

  // day 4: center CM columns + wrap
  if (dayConfig.tracks === 2) {
    try {
      for (var c2 = 15; c2 <= 22; c2++) {
        sheet.getRange(2, c2, maxR, 1).setHorizontalAlignment('center');
      }
      sheet.getRange(1, 22, maxR, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
      sheet.getRange(1, 23, maxR, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    } catch(e) {}
  }

  var row = 2;
  row = writeTrack(sheet, row, results.track1);

  if (dayConfig.tracks === 1) {
    writeUnassigned(sheet, row, results.unassigned);
  }

  if (dayConfig.tracks === 2) {
    writeCM(sheet, results.track2, results.unassigned);
  }
}


// chief minister (day 4 cols M-W)

function writeCM(sheet, cmAssigned, cmUnassigned) {
  var CM = CONFIG.CM_COL;

  // clear CM data (keep row 1 headers)
  var last = Math.max(sheet.getLastRow(), 100);
  if (last > 1) {
    sheet.getRange(2, CM.name, last - 1, 11).clearContent();
    safeClear(sheet.getRange(2, CM.name, last - 1, 11));
  }

  var slotMap = {};
  cmAssigned.forEach(function(e) { slotMap[e.slot] = e; });

  var row = 2;
  ALL_SLOTS.forEach(function(slot) {
    var entry = slotMap[slot];
    var endTime = END_TIMES[slot] || '';
    var dt = displayTime(slot);

    if (entry) {
      var p = entry.player;
      sheet.getRange(row, CM.name).setValue(p.name);
      setCellText(sheet, row, CM.start, dt);
      setCellText(sheet, row, CM.end, endTime);
      sheet.getRange(row, CM.timestamp).setValue(p.timestamp);
      sheet.getRange(row, CM.id).setValue(p.id);
      sheet.getRange(row, CM.alliance).setValue(p.alliance);
      sheet.getRange(row, CM.speedups).setValue(p.speedups);
      setCellText(sheet, row, CM.pref, p.prefRaw || p.preferred);
      setCellText(sheet, row, CM.alt, p.addRaw || p.allAvail.join(', '));
      sheet.getRange(row, CM.comments).setValue(p.comments || '');
    } else {
      sheet.getRange(row, CM.name).setValue('── OPEN ──');
      setCellText(sheet, row, CM.start, dt);
      setCellText(sheet, row, CM.end, endTime);
      safeBg(sheet.getRange(row, CM.name, 1, 11), '#b7e1cd');
      safeColor(sheet.getRange(row, CM.name, 1, 11), '#0b6623');
      safeItalic(sheet.getRange(row, CM.name, 1, 11), 'italic');
    }
    row++;
  });

  // CM unassigned
  if (cmUnassigned.length > 0) {
    row++;
    sheet.getRange(row, CM.name).setValue('⚠ CM UNASSIGNED');
    safeBold(sheet.getRange(row, CM.name, 1, 11), 'bold');
    safeBg(sheet.getRange(row, CM.name, 1, 11), '#f4cccc');
    safeColor(sheet.getRange(row, CM.name, 1, 11), '#990000');
    row++;

    sheet.getRange(row, CM.name).setValue('Player Name');
    sheet.getRange(row, CM.override).setValue('Override');
    sheet.getRange(row, CM.speedups).setValue('Speedups');
    sheet.getRange(row, CM.alliance).setValue('Alliance');
    sheet.getRange(row, CM.pref).setValue('Preferred');
    sheet.getRange(row, CM.alt).setValue('Availability');
    safeBold(sheet.getRange(row, CM.name, 1, 11), 'bold');
    safeBg(sheet.getRange(row, CM.name, 1, 11), '#f4cccc');
    safeColor(sheet.getRange(row, CM.name, 1, 11), '#990000');
    row++;

    cmUnassigned.sort(function(a, b) { return b.player.speedups - a.player.speedups; });
    cmUnassigned.forEach(function(entry) {
      var p = entry.player;
      sheet.getRange(row, CM.name).setValue(p.name);
      sheet.getRange(row, CM.speedups).setValue(p.speedups);
      sheet.getRange(row, CM.alliance).setValue(p.alliance);
      setCellText(sheet, row, CM.pref, p.prefRaw || p.preferred);
      setCellText(sheet, row, CM.alt, p.addRaw || p.allAvail.join(', '));
      safeBg(sheet.getRange(row, CM.name, 1, 11), '#fce5cd');
      row++;
    });
  }

  // format CM columns
  var maxR = Math.max(row, 60);
  try {
    for (var c = CM.start; c <= CM.alt; c++) {
      sheet.getRange(2, c, maxR, 1).setHorizontalAlignment('center');
    }
    sheet.getRange(1, CM.alt, maxR, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    sheet.getRange(1, CM.comments, maxR, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  } catch(e) {}
}


// init day sheets with OPEN rows

function initDaySheet(sheet, dayConfig) {
  var C = CONFIG.COL;
  var row = 2;
  ALL_SLOTS.forEach(function(slot) {
    sheet.getRange(row, C.name).setValue('── OPEN ──');
    setCellText(sheet, row, C.start, displayTime(slot));
    setCellText(sheet, row, C.end, END_TIMES[slot] || '');
    safeBg(sheet.getRange(row, 1, 1, 11), '#b7e1cd');
    safeColor(sheet.getRange(row, 1, 1, 11), '#0b6623');
    safeItalic(sheet.getRange(row, 1, 1, 11), 'italic');
    row++;
  });
}


// live assignment on form submit

function onFormSubmit(e) {
  if (!e || !e.range) return;
  quickAssign(e.range.getRow());
}

function quickAssign(formRow) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch(e) { Logger.log('Could not get lock'); return; }

  try {

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var formSheet = ss.getSheetByName(CONFIG.FORM_SHEET);
  if (!formSheet) return;

  var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
  var ci = colMap(headers.map(function(h) { return h ? String(h).trim() : ''; }));
  var rowData = formSheet.getRange(formRow, 1, 1, formSheet.getLastColumn()).getValues()[0];

  function val(col) {
    var i = ci[col];
    return (i !== undefined) ? rowData[i] : '';
  }

  var playerName = String(val('Player Name') || '').trim();
  if (!playerName) return;
  var playerId = val('Player ID');
  var alliance = val('Alliance');
  var timestamp = new Date();

  CONFIG.DAYS.forEach(function(dc) {
    if (String(val(dc.signupCol) || '').trim() !== 'Yes') return;

    var sheet = ss.getSheetByName(dc.sheetName);
    if (!sheet) return;

    var spd = Number(val(dc.speedupsCol)) || 0;
    var prefRaw = String(val(dc.prefCol) || '');
    var addRaw = String(val(dc.addCol) || '');
    var comments = String(val(dc.commentsCol) || '');
    var pref = extractStart(prefRaw);
    var adds = parseAvail(addRaw);
    var allAvail = [pref].concat(adds).filter(function(t) { return t.length === 5; });
    // dedupe
    var seen = {};
    allAvail = allAvail.filter(function(t) { return seen[t] ? false : (seen[t] = true); });

    var C = CONFIG.COL;

    // if sheet is empty (just reset), set up the slot layout first
    var row2time = String(sheet.getRange(2, C.start).getValue() || '').trim();
    if (!row2time) initDaySheet(sheet, dc);

    // batch-read the sheet (way faster than cell-by-cell)
    var last = sheet.getLastRow();
    var slotRows = {};
    var takenSlots = {};
    var oldRow = -1; // row to clear if player already exists

    if (last >= 2) {
      var data = sheet.getRange(2, 1, last - 1, 11).getValues();
      for (var ri = 0; ri < data.length; ri++) {
        var r = ri + 2;
        var n = String(data[ri][C.name - 1] || '').trim();
        var rawT = data[ri][C.start - 1];
        var t = normalizeTime(rawT);
        if (t) {
          slotRows[t] = r;
          if (n && n.indexOf('──') !== 0 && n !== '') takenSlots[t] = true;
        }
        if (n === playerName) {
          if (t) delete takenSlots[t];
          oldRow = r;
        }
      }
    }

    // clear old entry if resubmitting
    if (oldRow > 0) {
      sheet.getRange(oldRow, C.name).setValue('── OPEN ──');
      sheet.getRange(oldRow, C.timestamp).setValue('');
      sheet.getRange(oldRow, C.id).setValue('');
      sheet.getRange(oldRow, C.alliance).setValue('');
      sheet.getRange(oldRow, C.speedups).setValue('');
      setCellText(sheet, oldRow, C.pref, '');
      setCellText(sheet, oldRow, C.alt, '');
      sheet.getRange(oldRow, C.comments).setValue('');
      safeBg(sheet.getRange(oldRow, 1, 1, 11), '#b7e1cd');
      safeColor(sheet.getRange(oldRow, 1, 1, 11), '#0b6623');
      safeItalic(sheet.getRange(oldRow, 1, 1, 11), 'italic');
    }

    // pick best available slot
    var cands = allAvail.slice().sort(function(a, b) {
      if (a === pref) return -1;
      if (b === pref) return 1;
      return timeDist(a, pref) - timeDist(b, pref);
    });

    var slot = '';
    for (var i = 0; i < cands.length; i++) {
      if (!takenSlots[cands[i]] && slotRows[cands[i]]) {
        slot = cands[i]; break;
      }
    }

    if (slot && slotRows[slot]) {
      var sr = slotRows[slot];
      sheet.getRange(sr, C.name).setValue(playerName);
      setCellText(sheet, sr, C.start, displayTime(slot));
      setCellText(sheet, sr, C.end, END_TIMES[slot] || '');
      sheet.getRange(sr, C.timestamp).setValue(timestamp);
      sheet.getRange(sr, C.id).setValue(playerId);
      sheet.getRange(sr, C.alliance).setValue(alliance);
      sheet.getRange(sr, C.speedups).setValue(spd);
      setCellText(sheet, sr, C.pref, prefRaw);
      setCellText(sheet, sr, C.alt, addRaw);
      sheet.getRange(sr, C.comments).setValue(comments);
      safeBg(sheet.getRange(sr, 1, 1, 11), null);
      safeColor(sheet.getRange(sr, 1, 1, 11), null);
      safeItalic(sheet.getRange(sr, 1, 1, 11), null);

      // update schedule too
      updateScheduleSlot(dc, slot, playerName, alliance, playerId);
    } else {
      // no slot available, stick them at the bottom
      var empty = firstEmptyRow(sheet, C.name);
      sheet.getRange(empty, C.name).setValue(playerName);
      setCellText(sheet, empty, C.start, 'NEEDS ASSIGNMENT');
      sheet.getRange(empty, C.timestamp).setValue(timestamp);
      sheet.getRange(empty, C.id).setValue(playerId);
      sheet.getRange(empty, C.alliance).setValue(alliance);
      sheet.getRange(empty, C.speedups).setValue(spd);
      setCellText(sheet, empty, C.pref, prefRaw);
      setCellText(sheet, empty, C.alt, addRaw);
      sheet.getRange(empty, C.comments).setValue(comments);
      safeBg(sheet.getRange(empty, 1, 1, 11), '#fce5cd');
    }
  });

  } finally {
    lock.releaseLock();
  }
}

// update just one slot on the schedule (fast, called per form submit)
function updateScheduleSlot(dayConfig, slot, name, alliance, playerId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sched = ss.getSheetByName(CONFIG.SCHEDULE_SHEET);
  if (!sched) return;

  var colMap = { day1: 2, day2: 7, day4: 12 };
  var col = colMap[dayConfig.key];
  if (!col) return;

  var idx = ALL_SLOTS.indexOf(slot);
  if (idx === -1) return;
  var row = 4 + idx;

  sched.getRange(row, col + 1).setValue(name);
  sched.getRange(row, col + 2).setValue(alliance);
  sched.getRange(row, col + 3).setValue(playerId);
  safeBg(sched.getRange(row, col, 1, 4), null);
  safeColor(sched.getRange(row, col, 1, 4), null);
  safeItalic(sched.getRange(row, col, 1, 4), null);
}


// schedule writer

function writeSchedule() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sched = ss.getSheetByName(CONFIG.SCHEDULE_SHEET);
  if (!sched) return;

  // clear
  var last = Math.max(sched.getLastRow(), 55);
  var maxC = Math.max(sched.getMaxColumns(), 22);
  sched.getRange(1, 1, last, maxC).clearContent();
  safeClear(sched.getRange(1, 1, last, maxC));

  // colors
  var blue = '#4a86c8', green = '#6aa84f', orange = '#e69138', red = '#cc0000';
  var white = '#ffffff', lightGray = '#f3f3f3', openGreen = '#d9ead3';
  var stripe = '#f8f9fa';

  // section banners
  var sections = [
    { col: 2, span: 4, label: 'Day 1: Construction', bg: blue },
    { col: 7, span: 4, label: 'Day 2: Research', bg: green },
    { col: 12, span: 4, label: 'Day 4: Noble Advisor', bg: orange },
    { col: 17, span: 4, label: 'Day 4: Chief Minister', bg: red }
  ];

  sections.forEach(function(sec) {
    sched.getRange(2, sec.col, 1, sec.span).merge();
    sched.getRange(2, sec.col).setValue(sec.label);
    safeBg(sched.getRange(2, sec.col, 1, sec.span), sec.bg);
    safeColor(sched.getRange(2, sec.col, 1, sec.span), white);
    safeBold(sched.getRange(2, sec.col, 1, sec.span), 'bold');
    try {
      sched.getRange(2, sec.col, 1, sec.span).setFontSize(11);
      sched.getRange(2, sec.col, 1, sec.span).setHorizontalAlignment('center');
    } catch(e) {}
  });

  // sub-headers
  var hdrs = ['Time', 'Name', 'Alliance', 'ID'];
  [2, 7, 12, 17].forEach(function(sc) {
    hdrs.forEach(function(h, i) { sched.getRange(3, sc + i).setValue(h); });
    safeBg(sched.getRange(3, sc, 1, 4), lightGray);
    safeBold(sched.getRange(3, sc, 1, 4), 'bold');
    try { sched.getRange(3, sc, 1, 4).setHorizontalAlignment('center'); } catch(e) {}
  });

  // read data from day sheets
  SpreadsheetApp.flush();
  var C = CONFIG.COL;
  var dayData = {};

  ['Day 1', 'Day 2', 'Day 4'].forEach(function(sn) {
    var sh = ss.getSheetByName(sn);
    if (!sh) return;
    var d = {};
    var lr = sh.getLastRow();
    for (var r = 2; r <= lr; r++) {
      var n = String(sh.getRange(r, C.name).getValue() || '').trim();
      var t = normalizeTime(sh.getRange(r, C.start).getValue());
      var al = String(sh.getRange(r, C.alliance).getValue() || '').trim();
      var pid = sh.getRange(r, C.id).getValue();
      if (t && n.indexOf('──') !== 0 && n.indexOf('⚠') !== 0 && n !== 'Player Name') {
        d[t] = { name: n, alliance: al, id: pid || '' };
      }
    }
    dayData[sn] = d;
  });

  // CM data from Day 4 cols M-W
  var cmData = {};
  var d4 = ss.getSheetByName('Day 4');
  if (d4) {
    var cmc = CONFIG.CM_COL;
    var lr2 = d4.getLastRow();
    for (var r2 = 2; r2 <= lr2; r2++) {
      var n2 = String(d4.getRange(r2, cmc.name).getValue() || '').trim();
      var t2 = normalizeTime(d4.getRange(r2, cmc.start).getValue());
      var al2 = String(d4.getRange(r2, cmc.alliance).getValue() || '').trim();
      var pid2 = d4.getRange(r2, cmc.id).getValue();
      if (t2 && n2.indexOf('──') !== 0 && n2.indexOf('⚠') !== 0 && n2 !== 'Player Name') {
        cmData[t2] = { name: n2, alliance: al2, id: pid2 || '' };
      }
    }
  }

  // write rows
  var dataSources = [
    { col: 2, data: dayData['Day 1'] || {} },
    { col: 7, data: dayData['Day 2'] || {} },
    { col: 12, data: dayData['Day 4'] || {} },
    { col: 17, data: cmData }
  ];

  var numSlots = ALL_SLOTS.length;
  for (var si = 0; si < numSlots; si++) {
    var slot = ALL_SLOTS[si];
    var dt = displayTime(slot);
    var schedRow = 4 + si;
    var isStripe = si % 2 === 1;

    dataSources.forEach(function(src) {
      sched.getRange(schedRow, src.col).setValue(dt);
      safeBold(sched.getRange(schedRow, src.col), 'bold');
      try { sched.getRange(schedRow, src.col).setHorizontalAlignment('center'); } catch(e) {}

      var entry = src.data[dt] || src.data[slot];
      if (entry && entry.name) {
        sched.getRange(schedRow, src.col + 1).setValue(entry.name);
        sched.getRange(schedRow, src.col + 2).setValue(entry.alliance);
        sched.getRange(schedRow, src.col + 3).setValue(entry.id);
        if (isStripe) safeBg(sched.getRange(schedRow, src.col, 1, 4), stripe);
      } else {
        sched.getRange(schedRow, src.col + 1).setValue('— OPEN —');
        safeBg(sched.getRange(schedRow, src.col, 1, 4), openGreen);
        safeColor(sched.getRange(schedRow, src.col, 1, 4), '#38761d');
        safeItalic(sched.getRange(schedRow, src.col, 1, 4), 'italic');
      }
    });
  }

  // borders
  [2, 7, 12, 17].forEach(function(sc) {
    try {
      sched.getRange(2, sc, numSlots + 2, 4).setBorder(
        true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
      sched.getRange(4, sc, numSlots, 4).setBorder(
        null, null, null, null, true, true, '#d0d0d0', SpreadsheetApp.BorderStyle.SOLID);
      sched.getRange(2, sc, 1, 4).setBorder(
        null, null, true, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
      sched.getRange(3, sc, 1, 4).setBorder(
        null, null, true, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    } catch(e) {}
  });

  // column widths
  try {
    [1, 6, 11, 16].forEach(function(c) { sched.setColumnWidth(c, 30); });
    [2, 7, 12, 17].forEach(function(c) { sched.setColumnWidth(c, 55); });
    [3, 8, 13, 18].forEach(function(c) { sched.setColumnWidth(c, 140); });
    [4, 9, 14, 19].forEach(function(c) { sched.setColumnWidth(c, 60); });
    [5, 10, 15, 20].forEach(function(c) { sched.setColumnWidth(c, 85); });
  } catch(e) {}

  // center alliance + ID columns
  try {
    [4, 9, 14, 19].forEach(function(c) { sched.getRange(3, c, numSlots + 1, 1).setHorizontalAlignment('center'); });
    [5, 10, 15, 20].forEach(function(c) { sched.getRange(3, c, numSlots + 1, 1).setHorizontalAlignment('center'); });
  } catch(e) {}

  // white background everywhere for clean screenshots
  try {
    var totalR = numSlots + 15;
    sched.getRange(1, 1, totalR, 25).setBackground(white);
    sched.setHiddenGridlines(true);

    // re-apply colors that got whited out
    sections.forEach(function(sec) { safeBg(sched.getRange(2, sec.col, 1, sec.span), sec.bg); });
    [2, 7, 12, 17].forEach(function(sc) { safeBg(sched.getRange(3, sc, 1, 4), lightGray); });
    for (var ri = 4; ri < 4 + numSlots; ri++) {
      [2, 7, 12, 17].forEach(function(sc) {
        var cellVal = sched.getRange(ri, sc + 1).getValue();
        if (cellVal === '— OPEN —') {
          safeBg(sched.getRange(ri, sc, 1, 4), openGreen);
        } else if ((ri - 4) % 2 === 1 && cellVal) {
          safeBg(sched.getRange(ri, sc, 1, 4), stripe);
        }
      });
    }
  } catch(e) {}

  try { sched.setFrozenRows(3); } catch(e) {}
}


// reassign all

function reassignAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var ok = ui.alert('Reassign All Players',
    'This will clear all Day sheets and optimally re-assign everyone.\nContinue?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  var players = readFormData();
  if (players.length === 0) { ui.alert('No form responses found.'); return; }

  // day 1 first (needed for crossover)
  var d1cfg = CONFIG.DAYS.find(function(d) { return d.key === 'day1'; });
  var d1 = batchAssignDay(d1cfg, players, null);
  writeDaySheet(d1cfg, d1);

  // crossover: day 1 last slot player -> day 2 first slot
  var crossover = findCrossover(d1, players);
  if (crossover) Logger.log('Crossover: ' + crossover.playerName);

  // day 2
  var d2cfg = CONFIG.DAYS.find(function(d) { return d.key === 'day2'; });
  var d2 = batchAssignDay(d2cfg, players, crossover);
  writeDaySheet(d2cfg, d2);

  // day 4
  var d4cfg = CONFIG.DAYS.find(function(d) { return d.key === 'day4'; });
  var d4 = batchAssignDay(d4cfg, players, null);
  writeDaySheet(d4cfg, d4);

  writeSchedule();

  var msg = CONFIG.DAYS.map(function(dc) {
    var r = dc.key === 'day1' ? d1 : dc.key === 'day2' ? d2 : d4;
    return dc.label + ': ' + (r.track1.length + r.track2.length) + ' assigned, ' + r.unassigned.length + ' unassigned';
  }).join('\n');

  var crossMsg = crossover ? '\n\nCrossover: ' + crossover.playerName + ' (Day 1 → Day 2)' : '';
  ui.alert('Done', msg + crossMsg, ui.ButtonSet.OK);
}


// per-day reassign

function reassignDay1() { reassignOne('day1'); }
function reassignDay2() { reassignOne('day2'); }
function reassignDay4() { reassignOne('day4'); }

function reassignOne(dayKey) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var dc = CONFIG.DAYS.find(function(d) { return d.key === dayKey; });
  if (!dc) return;

  var players = readFormData();
  if (players.length === 0) { ui.alert('No form responses.'); return; }

  // check for crossover if doing day 2
  var crossover = null;
  if (dayKey === 'day2') {
    var d1sheet = ss.getSheetByName('Day 1');
    if (d1sheet) {
      var C = CONFIG.COL;
      for (var r = 2; r <= d1sheet.getLastRow(); r++) {
        var t = normalizeTime(d1sheet.getRange(r, C.start).getValue());
        var n = String(d1sheet.getRange(r, C.name).getValue() || '').trim();
        if (t === '23:45' && n && n.indexOf('──') !== 0) {
          var pd = players.find(function(p) { return p.name === n; });
          if (pd && pd.days.day2 && pd.days.day2.signedUp) {
            crossover = { playerName: n, reservedSlot: '00:00' };
          }
          break;
        }
      }
    }
  }

  var results = batchAssignDay(dc, players, crossover);
  writeDaySheet(dc, results);
  writeSchedule();

  var total = results.track1.length + results.track2.length;
  ui.alert(dc.label, total + ' assigned, ' + results.unassigned.length + ' unassigned', ui.ButtonSet.OK);
}


// manual processing

function processLastRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.FORM_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('No form responses.');
    return;
  }
  quickAssign(sheet.getLastRow());
  SpreadsheetApp.getUi().alert('Done - processed row ' + sheet.getLastRow());
}

function processAllRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.FORM_SHEET);
  if (!sheet) return;
  for (var r = 2; r <= sheet.getLastRow(); r++) quickAssign(r);
  SpreadsheetApp.getUi().alert('Processed ' + (sheet.getLastRow() - 1) + ' rows.');
}


// cycle management
// KvK runs every 4 weeks. Anchor: KvK #10 = March 23, 2026.

var CYCLE = {
  ANCHOR: new Date(2026, 2, 23),
  ANCHOR_NUM: 10,
  DAYS_IN_CYCLE: 28,
  ADVANCE_DAYS: 10,
  OFFSETS: { day1: 0, day2: 1, day4: 3 },
  WEEKDAYS: { day1: 'Monday', day2: 'Tuesday', day4: 'Thursday' }
};

function getNextDates(ref) {
  ref = ref || new Date();
  var anchor = new Date(CYCLE.ANCHOR);
  var msDay = 86400000;
  var since = Math.floor((ref.getTime() - anchor.getTime()) / msDay);
  var inCycle = since % CYCLE.DAYS_IN_CYCLE;
  if (inCycle < 0) inCycle += CYCLE.DAYS_IN_CYCLE;

  var day1;
  if (inCycle <= 3 && inCycle > 0) {
    day1 = new Date(ref.getTime() - inCycle * msDay);
  } else if (inCycle === 0) {
    day1 = new Date(ref);
  } else {
    day1 = new Date(ref.getTime() + (CYCLE.DAYS_IN_CYCLE - inCycle) * msDay);
  }
  day1.setHours(0, 0, 0, 0);

  var num = CYCLE.ANCHOR_NUM + Math.round((day1.getTime() - anchor.getTime()) / (CYCLE.DAYS_IN_CYCLE * msDay));

  return {
    day1: day1,
    day2: new Date(day1.getTime() + CYCLE.OFFSETS.day2 * msDay),
    day4: new Date(day1.getTime() + CYCLE.OFFSETS.day4 * msDay),
    num: num
  };
}

function getUpcomingDates() {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var d = getNextDates(today);
  if (d.day1.getTime() <= today.getTime()) {
    return getNextDates(new Date(d.day1.getTime() + (CYCLE.DAYS_IN_CYCLE + 1) * 86400000));
  }
  return d;
}

function fmtDate(date) {
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var d = date.getDate();
  var sfx = (d===1||d===21||d===31)?'st':(d===2||d===22)?'nd':(d===3||d===23)?'rd':'th';
  return days[date.getDay()] + ', ' + months[date.getMonth()] + ' ' + d + sfx + ', ' + date.getFullYear();
}

function fmtSection(date, dayKey) {
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var d = date.getDate();
  var sfx = (d===1||d===21||d===31)?'st':(d===2||d===22)?'nd':(d===3||d===23)?'rd':'th';
  return CYCLE.WEEKDAYS[dayKey] + ', ' + months[date.getMonth()] + ' ' + d + sfx + ' UTC';
}


// form date updater

function updateForm(dates) {
  dates = dates || getUpcomingDates();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var url = ss.getFormUrl();
  if (!url) { Logger.log('No linked form'); return false; }

  var form = FormApp.openByUrl(url);
  var kvkStr = 'KvK #' + dates.num;

  // update title
  var title = form.getTitle();
  if (/KvK\s*#\s*\d+/i.test(title)) {
    form.setTitle(title.replace(/KvK\s*#\s*\d+/gi, kvkStr));
  }

  // update description
  var desc = form.getDescription();
  if (/KvK\s*#\s*\d+/i.test(desc)) {
    form.setDescription(desc.replace(/KvK\s*#\s*\d+/gi, kvkStr));
  }

  // update section dates
  var dateRegex = /(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+UTC)?/gi;

  var dayMap = [
    { keys: ['day 1', 'construction'], date: fmtSection(dates.day1, 'day1') },
    { keys: ['day 2', 'research'], date: fmtSection(dates.day2, 'day2') },
    { keys: ['day 4', 'troop', 'training'], date: fmtSection(dates.day4, 'day4') }
  ];

  var currentDay = null;
  var items = form.getItems();
  items.forEach(function(item) {
    var t = (item.getTitle() || '').toLowerCase();
    dayMap.forEach(function(dm) {
      if (dm.keys.some(function(k) { return t.indexOf(k) >= 0; })) currentDay = dm;
    });

    if (currentDay) {
      var help = item.getHelpText();
      if (help) {
        dateRegex.lastIndex = 0;
        if (dateRegex.test(help)) {
          dateRegex.lastIndex = 0;
          item.setHelpText(help.replace(dateRegex, currentDay.date));
        }
      }
      dateRegex.lastIndex = 0;
      var tit = item.getTitle();
      if (tit && dateRegex.test(tit)) {
        dateRegex.lastIndex = 0;
        item.setTitle(tit.replace(dateRegex, currentDay.date));
      }
    }
  });

  Logger.log('Form updated: ' + kvkStr);
  return true;
}


// reset

function resetCycle() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // delete form response rows
  var formSheet = ss.getSheetByName(CONFIG.FORM_SHEET);
  if (formSheet && formSheet.getLastRow() > 1) {
    try { formSheet.deleteRows(2, formSheet.getLastRow() - 1); } catch(e) { Logger.log('Form clear error: ' + e); }
  }

  // delete day sheet rows
  CONFIG.DAYS.forEach(function(dc) {
    var sheet = ss.getSheetByName(dc.sheetName);
    if (!sheet) return;
    var last = sheet.getLastRow();
    if (last < 2) return;
    try {
      sheet.deleteRows(2, last - 1);
    } catch(e) {
      // fallback: blank out cell by cell
      var maxC = Math.max(sheet.getMaxColumns(), 23);
      for (var r = 2; r <= last; r++) {
        for (var c = 1; c <= maxC; c++) {
          try { sheet.getRange(r, c).setValue(''); } catch(e2) {}
        }
      }
    }
  });

  // delete schedule rows
  var sched = ss.getSheetByName(CONFIG.SCHEDULE_SHEET);
  if (sched && sched.getLastRow() > 3) {
    try { sched.deleteRows(4, sched.getLastRow() - 3); } catch(e) {}
  }

  // re-init day sheets with OPEN rows
  CONFIG.DAYS.forEach(function(dc) {
    var sheet = ss.getSheetByName(dc.sheetName);
    if (sheet) initDaySheet(sheet, dc);
  });

  // re-init schedule
  writeSchedule();
}


// new cycle (menu)

function manualNewCycle() {
  var ui = SpreadsheetApp.getUi();
  var dates = getUpcomingDates();

  var ok = ui.alert('Start New KvK Cycle',
    'This will:\n\n' +
    '1. Update the Google Form:\n' +
    '   Description → KvK #' + dates.num + '\n' +
    '   Day 1: ' + fmtSection(dates.day1, 'day1') + '\n' +
    '   Day 2: ' + fmtSection(dates.day2, 'day2') + '\n' +
    '   Day 4: ' + fmtSection(dates.day4, 'day4') + '\n\n' +
    '2. Clear all Form Responses\n' +
    '3. Clear all Day sheets (Day 1, Day 2, Day 4)\n\n' +
    'This cannot be undone. Continue?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  var formOk = updateForm(dates);
  resetCycle();

  var props = PropertiesService.getScriptProperties();
  props.setProperty('lastUpdatedCycle', dates.day1.toISOString().split('T')[0]);

  ui.alert('New Cycle Ready',
    (formOk ? 'Form updated.' : 'Could not update form (no linked form).') + '\n\n' +
    'KvK #' + dates.num + '\n' +
    'Day 1: ' + fmtSection(dates.day1, 'day1') + '\n' +
    'Day 2: ' + fmtSection(dates.day2, 'day2') + '\n' +
    'Day 4: ' + fmtSection(dates.day4, 'day4'),
    ui.ButtonSet.OK);
}


// auto-update (daily trigger)

function checkAutoUpdate() {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var dates = getUpcomingDates();
  var daysUntil = Math.round((dates.day1.getTime() - today.getTime()) / 86400000);

  if (daysUntil !== CYCLE.ADVANCE_DAYS) return;

  var props = PropertiesService.getScriptProperties();
  var key = dates.day1.toISOString().split('T')[0];
  if (props.getProperty('lastUpdatedCycle') === key) return;

  updateForm(dates);
  resetCycle();
  props.setProperty('lastUpdatedCycle', key);
  Logger.log('Auto-updated for cycle ' + key);
}


// preview / help

function previewDates() {
  var ui = SpreadsheetApp.getUi();
  var d = getUpcomingDates();
  var future = getNextDates(new Date(d.day1.getTime() + (CYCLE.DAYS_IN_CYCLE + 1) * 86400000));
  var autoDate = new Date(d.day1.getTime() - CYCLE.ADVANCE_DAYS * 86400000);

  ui.alert('Upcoming KvK Dates',
    'NEXT - KvK #' + d.num + ':\n' +
    '  Day 1: ' + fmtSection(d.day1, 'day1') + '\n' +
    '  Day 2: ' + fmtSection(d.day2, 'day2') + '\n' +
    '  Day 4: ' + fmtSection(d.day4, 'day4') + '\n' +
    '  Auto-update: ' + fmtDate(autoDate) + '\n\n' +
    'FOLLOWING - KvK #' + future.num + ':\n' +
    '  Day 1: ' + fmtSection(future.day1, 'day1') + '\n' +
    '  Day 2: ' + fmtSection(future.day2, 'day2') + '\n' +
    '  Day 4: ' + fmtSection(future.day4, 'day4'),
    ui.ButtonSet.OK);
}

function showOverrideHelp() {
  SpreadsheetApp.getUi().alert('Override Column (B on Day Sheets, N on Chief Minister)',
    'Type one of these in the Override column next to a player:\n\n' +
    '  SKIP      Exclude from this day\n' +
    '  ASSIGN    Must be included (even if below speedup cutoff)\n' +
    '  CHIEF     Move this player to Chief Minister track\n' +
    '  NOBLE     Move this player to Noble Advisor track\n' +
    '  09:45     Lock to a specific time slot\n' +
    '  (blank)   Normal algorithm\n\n' +
    'Overrides persist when you re-run Reassign All.\n' +
    'SKIP\'d players appear at the bottom of the sheet.\n\n' +
    'After making changes, run Reassign All (or Reassign Day X) to apply.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}


// setup

function setupAutoUpdate() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'checkAutoUpdate') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAutoUpdate').timeBased().everyDays(1).atHour(8).create();
  SpreadsheetApp.getUi().alert('Auto-update trigger created. Runs daily at ~8 AM, ' +
    CYCLE.ADVANCE_DAYS + ' days before each Day 1.');
}


// menu

function onOpen() {
  SpreadsheetApp.getUi().createMenu('KvK Signup')
    .addItem('Reassign All Days', 'reassignAll')
    .addSeparator()
    .addItem('Reassign Day 1 Only', 'reassignDay1')
    .addItem('Reassign Day 2 Only', 'reassignDay2')
    .addItem('Reassign Day 4 Only', 'reassignDay4')
    .addSeparator()
    .addItem('Process Last Form Row', 'processLastRow')
    .addItem('Process All Rows', 'processAllRows')
    .addSeparator()
    .addItem('Preview Next KvK Dates', 'previewDates')
    .addItem('Start New Cycle', 'manualNewCycle')
    .addItem('Setup Auto-Update', 'setupAutoUpdate')
    .addItem('Override Help', 'showOverrideHelp')
    .addToUi();
}
