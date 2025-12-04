const { POST_DELIVERY, DEATH_MIGRATION, PREGNANCY_SCREENING, ANC } = require('./constants');

//const moment = require('moment');
const today = getDateMS(Date.now());
const MS_IN_DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS_IN_PREGNANCY = 42 * 7;  // 42 weeks = 294 days
const pregnancyForms = ['pregnancy'];
const deliveryForms = ['delivery'];
const antenatalForms = ['pregnancy_home_visit'];

const getField = (report, fieldPath) => ['fields', ...(fieldPath || '').split('.')]
  .reduce((prev, fieldName) => {
    if (prev === undefined) { return undefined; }
    return prev[fieldName];
  }, report);

function isFormArraySubmittedInWindow(reports, formArray, start, end, count) {
  let found = false;
  let reportCount = 0;
  reports.forEach(function (report) {
    if (formArray.includes(report.form)) {
      if (report.reported_date >= start && report.reported_date <= end) {
        found = true;
        if (count) {
          reportCount++;
        }
      }
    }
  });

  if (count) { return reportCount >= count; }
  return found;
}

function isFormArraySubmittedInWindowExcludingThisReport(reports, formArray, start, end, exReport, count) {
  let found = false;
  let reportCount = 0;
  reports.forEach(function (report) {
    if (formArray.includes(report.form)) {
      if (report.reported_date >= start && report.reported_date <= end && report._id !== exReport._id) {
        found = true;
        if (count) {
          reportCount++;
        }
      }
    }
  });
  if (count) { return reportCount >= count; }
  else { return found; }
}

function getMostRecentReport(reports, form) {
  let result;
  reports.forEach(function (report) {
    if (form.includes(report.form) &&
      !report.deleted &&
      (!result || report.reported_date > result.reported_date)) {
      result = report;
    }
  });
  return result;
}

const isReportSkipped = (report, atHomeKey) => {
  if (getField(report, atHomeKey) === 'no') { return true; }
  return getField(report, 'agrees_for_service') === 'no';
};

const getMostRecentUnskippedReport = (allReports, form, atHomeKey) => {
  let result;

  allReports.filter(report => report.form === form && !report.deleted && !isReportSkipped(report, atHomeKey)).forEach(report => {
    if (!result || report.reported_date > result.reported_date) {
      result = report;
    }
  });

  return result;
};

function getNewestPregnancyTimestamp(contact) {
  if (!contact.contact) { return; }
  const newestPregnancy = getMostRecentReport(contact.reports, 'pregnancy');
  return newestPregnancy ? newestPregnancy.reported_date : 0;
}

function getNewestDeliveryTimestamp(contact) {
  if (!contact.contact) { return; }
  const newestDelivery = getMostRecentReport(contact.reports, 'delivery');
  return newestDelivery ? newestDelivery.reported_date : 0;
}

function isFacilityDelivery(contact, report) {
  if (!contact) {
    return false;
  }
  if (arguments.length === 1) { report = contact; }
  return getField(report, 'facility_delivery') === 'yes';
}

function isActive(contact) {
  return getMostRecentReport(contact.reports, DEATH_MIGRATION) === undefined;
}

function countReportsSubmittedInWindow(reports, form, start, end, condition) {
  let reportsFound = 0;
  reports.forEach(function (report) {
    if (form.includes(report.form)) {
      if (report.reported_date >= start && report.reported_date <= end) {
        if (!condition || condition(report)) {
          reportsFound++;
        }
      }
    }
  });
  return reportsFound;
}

function getReportsSubmittedInWindow(reports, form, start, end, condition) {
  const reportsFound = [];
  reports.forEach(function (report) {
    if (form.includes(report.form)) {
      if (report.reported_date >= start && report.reported_date <= end) {
        if (!condition || condition(report)) {
          reportsFound.push(report);
        }
      }
    }
  });
  return reportsFound;
}


function getDateISOLocal(s) {
  if (!s) { return new Date(); }
  const b = s.split(/\D/);
  const d = new Date(b[0], b[1] - 1, b[2]);
  if (isValidDate(d)) { return d; }
  return new Date();
}

function getTimeForMidnight(d) {
  const date = new Date(d);
  date.setHours(0);
  date.setMinutes(0);
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date;
}

function getDateMS(d) {
  if (typeof d === 'string') {
    if (d === '') { return null; }
    d = getDateISOLocal(d);
  }
  return getTimeForMidnight(d).getTime();
}

function isValidDate(d) {
  return d instanceof Date && !isNaN(d);
}

function addDays(date, days) {
  const result = getTimeForMidnight(new Date(date));
  result.setDate(result.getDate() + days);
  return result;
}

function isPregnancyForm(report) {
  return pregnancyForms.includes(report.form);
}

function isPregnancyFollowUpForm(report) {
  return antenatalForms.includes(report.form);
}

function isDeliveryForm(report) {
  return deliveryForms.includes(report.form);
}

const getNewestReport = function (reports, forms) {
  let result;
  reports.forEach(function (report) {
    if (!forms.includes(report.form)) { return; }
    if (!result || report.reported_date > result.reported_date) {
      result = report;
    }
  });
  return result;
};

const getLMPDateFromPregnancy = function (report) {
  return isPregnancyForm(report) &&
    getDateMS(getField(report, 'lmp_date_8601'));
};

const getLMPDateFromPregnancyFollowUp = function (report) {
  return isPregnancyFollowUpForm(report) &&
    getDateMS(getField(report, 'lmp_date_8601'));
};

const getDeliveryDate = (reports, report) => {
  let deliveryDate = getField(report, 'post_delivery_assessment.delivery_date_pdf');

  if (!deliveryDate) {
    deliveryDate = getField(getNewestReport(reports, [PREGNANCY_SCREENING]), 'standard.standard_delivery_date_pdf');
  }

  return new Date(deliveryDate || report.reported_date);
};

const getPPDays = (report) => {
  if (report.form !== POST_DELIVERY) {
    return undefined;
  }

  let ppDays = getField(report, 'pp_days');

  if (!ppDays || ppDays === '') {
    ppDays = 0;
  } else {
    ppDays = Number.parseInt(ppDays);
  }

  return ppDays;
};

function getSubsequentPregnancies(contact, refReport) {
  return contact.reports.filter(function (report) {
    return isPregnancyForm(report) && report.reported_date > refReport.reported_date;
  });
}

function getSubsequentPregnancyFollowUps(contact, report) {
  const subsequentVisits = contact.reports.filter(function (visit) {
    let lmpDate = getLMPDateFromPregnancy(report);
    if (!lmpDate) { //LMP Date is not available, use reported date
      lmpDate = report.reported_date;
    }

    return isPregnancyFollowUpForm(visit) &&
      visit.reported_date > report.reported_date &&
      visit.reported_date < addDays(lmpDate, MAX_DAYS_IN_PREGNANCY);
  });
  return subsequentVisits;
}

function getSubsequentDeliveries(contact, refReport, withinLastXDays) {
  return contact.reports.filter(function (deliveryReport) {
    return (deliveryReport.form === 'delivery') &&
      deliveryReport.reported_date > refReport.reported_date &&
      (!withinLastXDays || refReport.reported_date >= (today - withinLastXDays * MS_IN_DAY));
  });
}

const getLastMatchingReport = (contact, form, condition) => {
  return contact.reports.filter(report => report.form === form).find(report => condition(report));
};

function getMostRecentLMPDateForPregnancy(contact, report) {
  let mostRecentLMP = getLMPDateFromPregnancy(report);
  let mostRecentReportDate = report.reported_date;
  getSubsequentPregnancyFollowUps(contact, report).forEach(function (v) {
    const lmpFromPregnancyFollowUp = getLMPDateFromPregnancyFollowUp(v);
    if (v.reported_date > mostRecentReportDate && lmpFromPregnancyFollowUp !== '' && lmpFromPregnancyFollowUp !== mostRecentLMP) {
      mostRecentReportDate = v.reported_date;
      mostRecentLMP = lmpFromPregnancyFollowUp;
    }
  });
  return mostRecentLMP;
}

function isPregnancyTerminatedByAbortion(contact, report) {
  const followUps = getSubsequentPregnancyFollowUps(contact, report);
  const latestFollowup = getNewestReport(followUps, antenatalForms);
  return latestFollowup && getField(latestFollowup, 'pregnancy_summary.visit_option') === 'abortion';
}

function isPregnancyTerminatedByMiscarriage(contact, report) {
  const followUps = getSubsequentPregnancyFollowUps(contact, report);
  const latestFollowup = getNewestReport(followUps, antenatalForms);
  return latestFollowup && getField(latestFollowup, 'pregnancy_summary.visit_option') === 'miscarriage';
}

function isActivePregnancy(contact, report) {
  if (!isPregnancyForm(report)) { return false; }
  const lmpDate = getMostRecentLMPDateForPregnancy(contact, report) || report.reported_date;
  const isPregnancyRegisteredWithin9Months = lmpDate > today - MAX_DAYS_IN_PREGNANCY * MS_IN_DAY;
  const isPregnancyTerminatedByDeliveryInLast6Weeks = getSubsequentDeliveries(contact, report, 6 * 7).length > 0;
  const isPregnancyTerminatedByAnotherPregnancyReport = getSubsequentPregnancies(contact, report).length > 0;
  return isPregnancyRegisteredWithin9Months &&
    !isPregnancyTerminatedByDeliveryInLast6Weeks &&
    !isPregnancyTerminatedByAnotherPregnancyReport &&
    !isPregnancyTerminatedByAbortion(contact, report) &&
    !isPregnancyTerminatedByMiscarriage(contact, report);
}

function countANCFacilityVisits(contact, pregnancyReport) {
  let ancHFVisits = 0;
  const pregnancyFollowUps = getSubsequentPregnancyFollowUps(contact, pregnancyReport);
  if (getField(pregnancyReport, 'anc_visits_hf.anc_visits_hf_past') && !isNaN(getField(pregnancyReport, 'anc_visits_hf.anc_visits_hf_past.visited_hf_count'))) {
    ancHFVisits += parseInt(getField(pregnancyReport, 'anc_visits_hf.anc_visits_hf_past.visited_hf_count'));
  }
  ancHFVisits += pregnancyFollowUps.reduce(function (sum, report) {
    const pastANCHFVisits = getField(report, 'anc_visits_hf.anc_visits_hf_past');
    if (!pastANCHFVisits) { return 0; }
    sum += pastANCHFVisits.last_visit_attended === 'yes' && 1;
    if (isNaN(pastANCHFVisits.visited_hf_count)) { return sum; }
    return sum += pastANCHFVisits.report_other_visits === 'yes' && parseInt(pastANCHFVisits.visited_hf_count);
  },
  0);
  return ancHFVisits;
}

function getRecentANCVisitWithEvent(contact, report, event) {
  //event should be one among miscarriage, abortion, refused, migrated
  const followUps = getSubsequentPregnancyFollowUps(contact, report);
  const latestFollowup = getNewestReport(followUps, antenatalForms);
  if (latestFollowup && getField(latestFollowup, 'pregnancy_summary.visit_option') === event) {
    return latestFollowup;
  }
}

function isDangerSignPresentMother(report) { 
  return getField(report, 'mother_info.pnc_danger_sign_check').r_pnc_danger_sign_present === 'yes';
}

function isContactUnder2(contact) {
  const dob = contact && contact.contact && new Date(contact.contact.dob);
  
  // Do not create task if the age is not available
  if (!dob) {
    return false;
  }

  const today = new Date();

  const ageInMonths = today.getMonth() - dob.getMonth() + 12 * (today.getFullYear() - dob.getFullYear());
  return ageInMonths < 24;
}

const mapContent = (report, source = null) => {
  if (report === undefined) { return {}; }

  if (source === null) {
    source = report.form;
  }

  const contentMap = require(`./contents/${source}.map.json`)[report.form];
  const content = {};

  // Mapping fields from report to content
  Object.entries(contentMap).forEach(([key, field]) => {
    content[key] = getField(report, field);
  });

  return content;
};

//function to determine which report is more recent between ANC and Post Delivery
function compareANCAndPostDeliveryDates(contact) {
  const mostRecentANC = getMostRecentReport(contact.reports, [ANC]);
  const mostRecentPDF = getMostRecentReport(contact.reports, [POST_DELIVERY]);

  if (mostRecentANC && mostRecentPDF) {
    const ancDate = mostRecentANC.reported_date;
    const pdfDate = mostRecentPDF.reported_date;

    if (ancDate > pdfDate) {
      return 1;
    } else {
      return 2;
    }
  } else if (mostRecentANC) {
    return 1;
  } else if (mostRecentPDF) {
    return 2;
  } else {
    return null;
  }
}
//condition to check if it is at least 14 weeks since LMP
function isAtLeastXWeeksSinceLMP(contact, weeksThreshold) {
  const mostRecentANC = getMostRecentReport(contact.reports, [ANC]);
  const mostRecentANCs = compareANCAndPostDeliveryDates(contact);

  if (mostRecentANCs === 2) {
    return null;
  }

  if (mostRecentANC) {
    const lmpDateStr = getField(mostRecentANC, 'lmp_group.lmp_group_lmp');
    if (lmpDateStr) {
      const lmpDate = new Date(lmpDateStr);
      const today = new Date();
      const daysSinceLMP = Math.floor((today - lmpDate) / (1000 * 60 * 60 * 24));
      const weeksSinceLMP = Math.floor(daysSinceLMP / 7);
      return weeksSinceLMP >= weeksThreshold;
    }
  }
  return false;
}
//condition to check if it is below 10 months since delivery
function monthsdeliverydate(contact, weeksThreshold) {
  const mostRecentANCs = compareANCAndPostDeliveryDates(contact);

  if (mostRecentANCs === 1) {
    return null;
  }
  const mostRecentPDF = getMostRecentReport(contact.reports, [POST_DELIVERY]);
  if (mostRecentPDF) {
    const updatedDeliveryDate = getField(mostRecentPDF, 'post_delivery_assessment.delivery_date_pdf');
    const deliveryDate = getField(mostRecentPDF, 'delivery_date_pdf_ctx');

    const  useddeliverydate = updatedDeliveryDate || deliveryDate;
    if (useddeliverydate) {
      const lmpDate = new Date(useddeliverydate);
      const today = new Date();
      const daysSincedelivery = Math.floor((today - lmpDate) / (1000 * 60 * 60 * 24));
      const mothsSincedelivery = Math.floor(daysSincedelivery / 30.4);
      return mothsSincedelivery < weeksThreshold;
    }
  }
  return false;
}

//total forms for epds screening
const totalForms = (contact, formName) => {
  const latestScreening = getMostRecentReport(contact.reports, ['epds_screening']);

  if (!latestScreening) {
    return null;
  }

  const moduleForms = contact.reports.filter(report => report.form === formName);

  if (moduleForms.length === 0) {
    return 1;
  }

  return Math.min(moduleForms.length + 1, Number.MAX_SAFE_INTEGER);
};

function getpdfContent(contact) {
  const mostRecentPDF = getMostRecentReport(contact.reports, ['post_delivery_form']);
  const childIndexes = [1, 2, 3, 4]; 
  const ntW = ['one', 'two', 'three', 'four'];
  const outcome = getField(mostRecentPDF, 'post_delivery_assessment.pregnancy_outcome');

  const hasLiveBirth = childIndexes.some(i => {
    const word = ntW[i - 1];
    return getField(mostRecentPDF, `child_${word}.child_${word}_birth_outcome${i}`) === 'live_birth';
  });

  const hasAliveChild = childIndexes.some(i => {
    const word = ntW[i - 1];
    return getField(mostRecentPDF, `child_${word}.child_${word}_child_status${i}`) === 'alive';
  });

  if (outcome === 'delivery_28_weeks' && hasLiveBirth && hasAliveChild) {
    return 1;
  }

  return 2;
}

function validateANCisLatestAndNoEPDS(contact) {
  const comparisonResult = compareANCAndPostDeliveryDates(contact);

  if (comparisonResult === 1) {
    // Check if there's any EPDS_SCREENING form
    const epdsForm = getMostRecentReport(contact.reports, ['epds_screening']);
    
    if (!epdsForm) {
      return 1;
    }
  }

  return null;
}
// function comparePDFAndEPDSDates(contact) {
//   const reports = contact.reports || [];

//   const anc = getMostRecentReport(reports, [ANC]);
//   const pdf = getMostRecentReport(reports, [POST_DELIVERY]);
//   const latestEpds = getMostRecentReport(reports, ['epds_screening']);

//   const ancDate = anc && anc.reported_date ? anc.reported_date : 0;
//   const pdfDate = pdf && pdf.reported_date ? pdf.reported_date : 0;
//   const latestEpdsDate = latestEpds && latestEpds.reported_date ? latestEpds.reported_date : 0;

  
//   if (ancDate && !pdfDate) {
//     return 'active';
//   }


//   if (ancDate && pdfDate && latestEpdsDate > ancDate && latestEpdsDate > pdfDate) {
//     return 'active';
//   }

//   return 'not_active';
// }
// function comparePDFAndEPDSDates(contact) {
//   const reports = contact.reports || [];

//   const anc = getMostRecentReport(reports, [ANC]);
//   const pdf = getMostRecentReport(reports, [POST_DELIVERY]);
//   const latestEpds = getMostRecentReport(reports, ['epds_screening']);

//   const now = Date.now();
//   const twoYearsAgo = now - 1.5 * 365 * 24 * 60 * 60 * 1000; // ~2 years in milliseconds

//   const ancDate = anc && anc.reported_date > twoYearsAgo ? anc.reported_date : 0;
//   const pdfDate = pdf && pdf.reported_date > twoYearsAgo ? pdf.reported_date : 0;
//   const latestEpdsDate = latestEpds && latestEpds.reported_date > twoYearsAgo ? latestEpds.reported_date : 0;
//   console.log('ancDate:', anc.reported_date, 'pdfDate:', pdf.reported_date, 'latestEpdsDssggate:', twoYearsAgo);


//   if (ancDate && !pdfDate) {
//     return 'active';
//   }

//   if (ancDate && pdfDate && latestEpdsDate > ancDate && latestEpdsDate > pdfDate) {
//     return 'active';
//   }

//   return 'not_active';
// }


// function recurringS(contact) {
//   const reports = contact.reports || [];

//   const anc = getMostRecentReport(reports, [ANC]);
//   const pdf = getMostRecentReport(reports, [POST_DELIVERY]);
//   const latestEpds = getMostRecentReport(reports, ['epds_screening']);

//   const ancDate = anc && anc.reported_date ? anc.reported_date : 0;
//   const pdfDate = pdf && pdf.reported_date ? pdf.reported_date : 0;

//   if (ancDate > pdfDate) {
//     return 'active';
//   }

//   if (pdfDate > ancDate) {
//     const deliveryd = getField(latestEpds, 'delivery_date');
//     const updated_dd = getField(latestEpds, 'updated_dd');

//     const ppDays = (!updated_dd || updated_dd === 'NaN') ? deliveryd : updated_dd;

//     if (ppDays) {
//       const ppDate = new Date(ppDays);
//       const today = new Date();
//       const diffTime = today - ppDate;
//       const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

//     // ✅ Console logging
//     console.log('real Dayxs:', deliveryd);
//     console.log('uodaete PDF:', updated_dd);
//     console.log('Twhcihc Days:', ppDays);
//     console.log('diff Days:', diffTime);
//     console.log('final  Days:', diffDays);


//     if (diffDays < 299) {
//       return 'active';
//     }
//   }
// }

//   return 'not_active';
// }

// const totalSessionPsupp = (contact) => {

//   const latestPsuppForm = getMostRecentReport(contact.report, ['psupp_form']);
//   if (!latestPsuppForm) return null;

//   const sessionFrom = contact.reports.findIndex (report => report._id === latestPsuppForm._id);
//   const count = contact.reports.slice(sessionFrom + 1).filter(report => report.form === 'pssup_session_1').length;
//   return count +1;
// }
// console.log("get the most recent psupp formdata " , totalSessionPsupp);

// const totalSessionPsupp = (contact) => {
//   const latestPsuppForm = getMostRecentReport(contact.reports, ['psupp_form']);
//   if (!latestPsuppForm){
//     return null;
//   }
//   const sessionFrom = contact.reports.findIndex(report => report._id === latestPsuppForm._id);
//   const count = contact.reports
//     .slice(sessionFrom + 1)
//     .filter(report => report.form === 'psupp_session_1').length;

//   return count + 1;
// };

// // Example usage


// const totalPsuppSessions = (contact, formName) => {
//   // Get the latest psupp_form
//   const latestPsuppForm = getMostRecentReport(contact.reports, ['psupp_form']);
//   if (!latestPsuppForm){
//     return null;
//   }

//   // Count psupp_session_1 forms after the latest psupp_form
//   const sessionsAfterLatestForm = contact.reports.filter(
//     report => report.reported_date > latestPsuppForm.reported_date && report.form === formName
//   );

//   // Return 0 if none, else count + 1
//   return sessionsAfterLatestForm.length === 0
//     ? 1
//     : Math.min(sessionsAfterLatestForm.length + 1, Number.MAX_SAFE_INTEGER);
// };
// const totalPsuppSessions = (contact, formName) => {
//   // Get the latest psupp_form
//   const latestPsuppForm = getMostRecentReport(contact.reports, ['psupp_form']);
//   if (!latestPsuppForm) {
//     return null;
//   }

//   // Count psupp_session forms after the latest psupp_form
//   const sessionsAfterLatestForm = contact.reports.filter(
//     report => report.reported_date > latestPsuppForm.reported_date && report.form === formName
//   );

//   // Return the exact count (0, 1, 2, 3, ...)
//   return sessionsAfterLatestForm.length + 1;
// };

const formCapMap = {
  'psupp_home_visit': 3,
  'psupp_weekly_visit': 3,
  'psupp_form': 1   // default max sessions after baseline form
};

// const totalPsuppSessions = (contact, formName) => {
//   const latestPsuppForm = getMostRecentReport(contact.reports, ['psupp_form']);
//   if (!latestPsuppForm) {
//     return null;
//   }
//   const count = contact.reports.filter(r => r.form === formName && r.reported_date > latestPsuppForm.reported_date).length;

//   return 'visit_' + Math.min(count + 1, 5);
// };
const totalPsuppSessions = (contact, formName) => {
  const latestPsuppForm = getMostRecentReport(contact.reports, ['psupp_form']);
  if (!latestPsuppForm) {
    return null;
  }

  const count = contact.reports.filter(r => r.form === formName && r.reported_date > latestPsuppForm.reported_date).length;

  const cap = formCapMap[formName] || 5;

  return 'visit_' + Math.min(count + 1, cap);
};

module.exports = {
  today,
  MS_IN_DAY,
  MAX_DAYS_IN_PREGNANCY,
  totalPsuppSessions,
  //recurringS,
  getpdfContent,
  //comparePDFAndEPDSDates,
  validateANCisLatestAndNoEPDS,
  totalForms,
  compareANCAndPostDeliveryDates,
  isAtLeastXWeeksSinceLMP,
  monthsdeliverydate,
  addDays,
  isActive,
  isDangerSignPresentMother,
  getTimeForMidnight,
  isContactUnder2,
  isFormArraySubmittedInWindow,
  isFormArraySubmittedInWindowExcludingThisReport,
  getDateMS,
  getDateISOLocal,
  isDeliveryForm,
  getMostRecentReport,
  getNewestPregnancyTimestamp,
  getNewestDeliveryTimestamp,
  getReportsSubmittedInWindow,
  countReportsSubmittedInWindow,
  countANCFacilityVisits,
  isFacilityDelivery,
  getMostRecentLMPDateForPregnancy,
  getNewestReport,
  getSubsequentPregnancyFollowUps,
  isActivePregnancy,
  getRecentANCVisitWithEvent,
  getField,
  getDeliveryDate,
  getPPDays,
  getLastMatchingReport,
  isReportSkipped,
  getMostRecentUnskippedReport,
  mapContent
};
