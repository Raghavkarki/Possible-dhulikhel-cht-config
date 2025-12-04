const moment = require('moment');
const {
  ANC, ANC_COUNT, PREGNANCY_SCREENING, POST_DELIVERY, PNC, PNC2, U2_REGISTRY,
  PREGNANCY_HISTORY, PROCEDURE_DATE_GROUP, AGREES_KEYS, HOME_KEYS, MUAC_GROUP,
  MUAC_GROUP_OLD, STOCK_IN, STOCK_OUT, PSUPP, PSUPP_HOME_VISIT, PSUPP_WEEKLY_VISIT,
  PSUPP_BI_WEEKLY_VISIT
} = require('./constants');
const today = moment().startOf('day');

const isReportValid = function (report) {
  if (report.form && report.fields && report.reported_date) { return true; }
  return false;
};

const PATIENT_TYPE = 'c82_person';
const allPlaces =
  [
    'c10_center', 'c20_province', 'c30_district', 'c40_municipality',
    'c50_ward'
  ];

const allPersons = [
  'c12_center_contact', 'c22_province_contact', 'c32_district_contact', 'c42_municipality_contact',
  'c52_ward_contact', 'c62_chn_area_contact', 'c72_fchv_area_contact'
];

const nonHouseholdPlaces = allPlaces.filter(place => place !== 'c80_household');
const nonHouseholdPersons = allPersons.filter(person => person !== 'c82_person');

const lifeEventForms = ['death_and_migration_form'];

const getField = (report, fieldPath) => ['fields', ...(fieldPath || '').split('.')]
  .reduce((prev, fieldName) => {
    if (prev === undefined) { return undefined; }
    return prev[fieldName];
  }, report);

const getIntegerField = (report, fieldPath) => {
  const value = getField(report, fieldPath);

  if (value === '') {
    return 0;
  }

  return Number.parseInt(value);
};

const getAggregatedReport = (reports, fields) => {
  if (reports === undefined) {
    return undefined;
  }

  const aggregatedReport = {};

  // Initilizing aggregates
  fields.forEach((field) => {
    aggregatedReport[field] = 0;
  });

  reports.forEach((report) => {
    fields.forEach((field) => {
      aggregatedReport[field] += getIntegerField(report, field);
    });
  });

  return aggregatedReport;
};

function getFormArraySubmittedInWindow(allReports, formArray, start, end) {
  return allReports.filter(function (report) {
    return formArray.includes(report.form) &&
      report.reported_date >= start && report.reported_date <= end;
  });
}

function getReportsBetween(allReports, forms, after, before = Date.now()) {
  return allReports.filter(report => forms.includes(report.form) && report.reported_date > after && report.reported_date < before);
}

function getNewestReport(allReports, forms, before = undefined, skipCondition = undefined) {
  let result;
  allReports.forEach(function (report) {
    if (!isReportValid(report) || !forms.includes(report.form)) { return; }
    if (before && before < report.reported_date) { return; }
    if (skipCondition && skipCondition(report)) { return; }
    if (!result || report.reported_date > result.reported_date) {
      result = report;
    }
  });
  return result;
}

const isReportSkipped = (report) => {
  if (getField(report, HOME_KEYS[report.form]) === 'no') { return true; }
  return getField(report, AGREES_KEYS[report.form]) === 'no';
};

const getMostRecentUnskippedReport = (allReports, form) => {
  let result;

  allReports.filter(report => report && report.form === form && !report.deleted && !isReportSkipped(report)).forEach(report => {
    if (!result || report.reported_date > result.reported_date) {
      result = report;
    }
  });

  return result;
};

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

const formatDate = (date) => date.toISOString().split('T')[0];

function getAgeFromDOB(dob) {
  return Math.floor(Math.abs(new Date() - new Date(dob)) / (1000 * 60 * 60 * 24 * 365));
}

function isAlive(thisContact) {
  return thisContact && !thisContact.date_of_death;
}

const isActive = (allReports) => {
  return allReports && getNewestReport(allReports, lifeEventForms) === undefined;
};

const checkNotEmptyOrUndefined = (value) => value !== '' && value !== undefined;

function isANCActive(allReports) {
  // Checking latest PSS for ANC
  const mostRecentPSS = getNewestReport(allReports, [PREGNANCY_SCREENING]);

  // Return ANC false if last PSS is skipped
  if (isReportSkipped(mostRecentPSS)) { return false; }

  const mostRecentPDF = getNewestReport(allReports, [POST_DELIVERY]);
  if (mostRecentPDF && mostRecentPDF.reported_date > mostRecentPSS) { return false; }

  if (getField(mostRecentPSS, 'anc') === '1') {
    const mostRecentANC = getNewestReport(allReports, [ANC], null, (ancReport) => ancReport.reported_date < mostRecentPSS.reported_date);
    return !mostRecentANC || getField(mostRecentANC, 'anc') !== '0' || getField(mostRecentANC, 'eligible_woman') !== '1' || getField(mostRecentANC, 'post_delivery') !== '1';
  }

  return false;
}

function isInitilizationComplete(thisContact, allReports, formName, extraConditions = null) {
  if (thisContact.contact_type !== PATIENT_TYPE) { return false; }

  const previousReport = getNewestReport(allReports, [formName]);
  if (previousReport === undefined) { return false; }

  return (extraConditions) ? extraConditions(previousReport) : true;
}

function isFormClosed(report) {
  return report && report.fields && report.fields.remove_woman === '1';
}

const getPersonLifeStatus = (allReports) => {
  const dmReport = getNewestReport(allReports, lifeEventForms);

  const statusText = {
    'permanent_migration': 'Migrated',
    'person_death': 'Deceased',
    'maternal_death': 'Maternal Death',
    'neonatal_death': 'Neo-natal Death'
  };

  if (dmReport === undefined) {
    return 'Active';
  }

  return statusText[getField(dmReport, 'reason')];
};

function getFieldRecent(allReports, form, field, condition) {
  let value;
  let reportedDate;

  allReports.forEach(function (report) {
    if (!isReportValid(report) || report.form !== form) { return; }

    if (reportedDate && reportedDate > report.reported_date) { return; }

    const fieldValue = getField(report, field);
    if (condition(fieldValue)) {
      value = fieldValue;
      reportedDate = report.reported_date;
    }
  });

  return value;
}

function getFieldOnce(allReports, form, field, condition) {
  let value;

  allReports.some(function (report) {
    if (!isReportValid(report) || report.form !== form) { return; }

    const fieldValue = getField(report, field);
    if (condition(fieldValue)) {
      value = fieldValue;
      return true;
    }

    return;
  });

  return value;
}

function getCurrentANCReports(allReports) {
  // Fetching all current ANC Reports
  const ancStartTime = getNewestReport(allReports, [PREGNANCY_SCREENING]).reported_date;
  return getReportsBetween(allReports, [ANC], ancStartTime);
}

function getCurrentANCVisits(ancReports, context) {
  // Case variables for anc visits
  for (let i = 1; i <= ANC_COUNT; i++) {
    ancReports.forEach(ancReport => {
      const recordGroup = getField(ancReport, `anc_record.anc_record_visit${i}`);

      if (recordGroup !== undefined) {
        if (checkNotEmptyOrUndefined(recordGroup[`anc_record_visit${i}_anc_visit_type`])) {
          context[`anc_visit${i}_type`] = recordGroup[`anc_record_visit${i}_anc_visit_type`];
          context[`anc_visit${i}_date_nepali`] = recordGroup[`anc_record_visit${i}_anc_visit_date_nepali`];
          context[`anc_visit${i}_month`] = recordGroup[`anc_record_visit${i}_anc_visit_month`];
        }

        if (checkNotEmptyOrUndefined(recordGroup[`anc_record_visit${i}_anc_visit${i}_complete`])) {
          context[`anc_visit${i}_complete`] = recordGroup[`anc_record_visit${i}_anc_visit${i}_complete`];
        }
      }
    });

  }
}

function getPSSContext(allReports, context) {
  // Getting PSS Context from last report triggering the task
  [PREGNANCY_SCREENING, POST_DELIVERY].forEach(form => {
    const mostRecentUnskippedReport = getMostRecentUnskippedReport(allReports, form);

    if (mostRecentUnskippedReport) {
      context = Object.assign(context, mapContent(mostRecentUnskippedReport, PREGNANCY_SCREENING));
    }
  });

  context.iud_date = getFieldRecent(allReports, PREGNANCY_SCREENING, `${PROCEDURE_DATE_GROUP}_iud_date`, checkNotEmptyOrUndefined);
  context.fem_steralize_date = getFieldRecent(allReports, PREGNANCY_SCREENING, `${PROCEDURE_DATE_GROUP}_fem_steralize_date`, checkNotEmptyOrUndefined);
  context.male_steralize_date = getFieldRecent(allReports, PREGNANCY_SCREENING, `${PROCEDURE_DATE_GROUP}_male_steralize_date`, checkNotEmptyOrUndefined);
  context.implant_date = getFieldRecent(allReports, PREGNANCY_SCREENING, `${PROCEDURE_DATE_GROUP}_implant_date`, checkNotEmptyOrUndefined);
  context.implant_date_second = getFieldRecent(allReports, PREGNANCY_SCREENING, `${PROCEDURE_DATE_GROUP}_implant_date_second`, checkNotEmptyOrUndefined);

  context.last_bcs_date = getFieldRecent(allReports, PREGNANCY_SCREENING, 'balanced_counseling.balanced_counseling_bcs_form.balanced_counseling_bcs_form_last_bcs_date', checkNotEmptyOrUndefined);
  context.last_bcs_date_nepali = getFieldRecent(allReports, PREGNANCY_SCREENING, 'balanced_counseling.balanced_counseling_bcs_form.balanced_counseling_bcs_form_last_bcs_date_nepali', checkNotEmptyOrUndefined);
}

function getU2Context(thisContact, allReports, context) {
  context.has_initialized_u2 = isInitilizationComplete(thisContact, allReports, U2_REGISTRY, (report) => Math.floor((new Date().getTime() - report.reported_date) / (1000 * 60 * 60 * 24)) < 38);

  const mostRecentTriggerReport = getMostRecentUnskippedReport(allReports, U2_REGISTRY);
  if (mostRecentTriggerReport) {
    context = Object.assign(context, mapContent(mostRecentTriggerReport));
  }

  const OVER_2_GROUP = 'group_assessment_agreeinservice.over_2_questions.over_2_questions';
  const condition = (fieldValue) => fieldValue === 'yes';

  context.vitamin_a_caps_once = getFieldOnce(allReports, U2_REGISTRY, `${OVER_2_GROUP}_vitamin_a_caps_once`, condition);
  context.vitamin_a_caps_twice = getFieldOnce(allReports, U2_REGISTRY, `${OVER_2_GROUP}_vitamin_a_caps_twice`, condition);
  context.vitamin_a_caps_thrice = getFieldOnce(allReports, U2_REGISTRY, `${OVER_2_GROUP}_vitamin_a_caps_thrice`, condition);
  context.anti_worm_tablet = getFieldOnce(allReports, U2_REGISTRY, `${OVER_2_GROUP}_anti_worm_tablet`, condition);
  context.anti_worm_tablet_twice = getFieldOnce(allReports, U2_REGISTRY, `${OVER_2_GROUP}_anti_worm_tablet_twice`, condition);

  context.muac_update = getFieldRecent(allReports, U2_REGISTRY, MUAC_GROUP, checkNotEmptyOrUndefined) || getFieldRecent(allReports, U2_REGISTRY, MUAC_GROUP_OLD, checkNotEmptyOrUndefined);
}

function getPDFContext(allReports, context, ancCheck = true) {
  const latestPSSReport = getNewestReport(allReports, [PREGNANCY_SCREENING]);

  context.pregnancy_status = getField(latestPSSReport, 'standard_pregnancy.standard_pregnancy_status');
  context.pregnancy_status_update = getField(latestPSSReport, 'pregnancy_status_update');

  if (ancCheck) {
    const ancReports = getCurrentANCReports(allReports);
    const latestANCReport = getNewestReport(ancReports, [ANC]);

    getCurrentANCVisits(ancReports, context);

    context.high_risk = getField(latestANCReport, 'high_risk.high_risk_high_risk');
  }
}

function getPNC1Context(allReports, context) {
  const latestPNC = getMostRecentUnskippedReport(allReports, PNC);
  const latestPSSReport = getNewestReport(allReports, [PREGNANCY_SCREENING]);

  context.pregnancy_status_update = getField(latestPSSReport, 'pregnancy_status_update');
  context.visit_pnc1_month = getField(latestPNC, 'reporting_pnc1_visit_group_visit_pnc1_month');
  context.counseling_month = getField(latestPNC, 'reporting_pnc1_counseling_group_counseling_month');
  context.pp_6weeks_month = getField(latestPNC, 'reporting_pp_6weeks_group_pp_6weeks_month');
  context.pp_6weeks_counsel_month = getField(latestPNC, 'reporting_pp_6weeks_counsel_pp_6weeks_counsel_month');
  context.dangersign_referral_month = getField(latestPNC, 'reporting_pp_dangersign_referral_group_dangersign_referral_month');
  context.dangersign_referral_followup_month = getField(latestPNC, 'reporting_pp_dangersign_referral_followup_group_dangersign_referral_followup_month');
  context.close_form = getField(latestPNC, 'until_6_weeks_questions_close_form');
  context.phq2_refer = getField(latestPNC, 'year_after_delivery_phq2_refer');
}

function getPNC2Context(allReports, context) {
  const latestPNC = getMostRecentUnskippedReport(allReports, PNC);
  const latestPSSReport = getNewestReport(allReports, [PREGNANCY_SCREENING]);

  context.pregnancy_status_update = getField(latestPSSReport, 'pregnancy_status_update');
  context.visit_pnc2_month = getField(latestPNC, 'reporting_pnc2_visit_group_visit_pnc2_month');
  context.counseling_pnc2_month = getField(latestPNC, 'reporting_pnc2_counseling_group_counseling_month_pnc2');
  context.pp_6weeks_month_pnc2 = getField(latestPNC, 'reporting_pp_6weeks_group_pp_6weeks_month_pnc2');
  context.pp_6weeks_counsel_month_pnc2 = getField(latestPNC, 'reporting_pp_6weeks_counsel_pp_6weeks_counsel_month_pnc2');
  context.dangersign_referral_month_pnc2 = getField(latestPNC, 'reporting_pp_dangersign_referral_group_dangersign_referral_month_pnc2');
  context.dangersign_referral_followup_month_pnc2 = getField(latestPNC, 'reporting_pp_dangersign_referral_followup_group_dangersign_referral_followup_month_pnc2');
  context.close_form = getField(latestPNC, 'until_6_weeks_questions_close_form');
  context.phq2_refer = getField(latestPNC, 'year_after_delivery_phq2_refer');
}

function getANCContext(allReports, context) {
  // Fetching all current ANC Reports
  const ancReports = getCurrentANCReports(allReports);
  const latestANCReport = getMostRecentUnskippedReport(ancReports, ANC);
  // Assinging ANC variables
  context.visit_anc_month = getField(latestANCReport, 'reporting_anc_visit_group_visit_anc_month');
  context.anc_visit_count_counter = getField(latestANCReport, 'anc_visit_count_counter');
  context.anc_visit_count = getField(latestANCReport, 'visit_counts_anc_visit_count');
  context.muac_counter_anc = getField(latestANCReport, 'muac_measurement.muac_measurement_muac_counter_anc');
  context.hypertensive_nonchronic = getField(latestANCReport, 'hypertension_calculations_hypertensive_nonchronic');
  context.usg_history = getField(latestANCReport, 'usg_history');
  context.desired_pregnancy = getFieldOnce(ancReports, ANC, 'followup.followup_desired_pregnancy', checkNotEmptyOrUndefined);

  // Extracting high risk values
  context.high_risk_hypertension_chronic = getField(latestANCReport, 'high_risk.high_risk_high_risk_hypertension_chronic');
  context.high_risk_hypertension_new = getField(latestANCReport, 'high_risk.high_risk_high_risk_hypertension_new');
  context.high_risk_diabetes_history = getField(latestANCReport, 'high_risk.high_risk_high_risk_diabetes_history');
  context.high_risk_hiv = getField(latestANCReport, 'high_risk.high_risk_high_risk_hiv');
  context.high_risk_hbsag = getField(latestANCReport, 'high_risk.high_risk_high_risk_hbsag');
  context.high_risk_hcv = getField(latestANCReport, 'high_risk.high_risk_high_risk_hcv');
  context.high_risk_vdrl = getField(latestANCReport, 'high_risk.high_risk_high_risk_vdrl');
  context.high_risk_anemia = getField(latestANCReport, 'high_risk.high_risk_high_risk_anemia');
  context.high_risk_diabetes_new = getField(latestANCReport, 'high_risk.high_risk_high_risk_diabetes_new');
  context.high_risk_rh_negative = getField(latestANCReport, 'high_risk.high_risk_high_risk_rh_negative');
  context.high_risk_placenta_previa = getField(latestANCReport, 'high_risk.high_risk_high_risk_placenta_previa');
  context.high_risk_fetal_presentation = getField(latestANCReport, 'high_risk.high_risk_high_risk_fetal_presentation');
  context.high_risk_no_of_fetus = getField(latestANCReport, 'high_risk.high_risk_high_risk_no_of_fetus');
  context.high_risk_urine_protein = getField(latestANCReport, 'high_risk.high_risk_high_risk_urine_protein');
  context.high_risk_urine_sugar = getField(latestANCReport, 'high_risk.high_risk_high_risk_urine_sugar');
  context.high_risk_grandmultiparity = getField(latestANCReport, 'high_risk.high_risk_high_risk_grandmultiparity');
  context.referral_immediate_hospital = getField(latestANCReport, 'referral_followup_referral_immediate_hospital');
  context.referral_1week_hospital = getField(latestANCReport, 'referral_followup_referral_1week_hospital');

  // Government Windows
  context.start_date_4 = getFieldRecent(ancReports, ANC, 'govt_windows.govt_windows_anc_gov_window_4_start_date_4', checkNotEmptyOrUndefined);
  context.start_date_6 = getFieldRecent(ancReports, ANC, 'govt_windows.govt_windows_anc_gov_window_6_start_date_6', checkNotEmptyOrUndefined);
  context.start_date_8 = getFieldRecent(ancReports, ANC, 'govt_windows.govt_windows_anc_gov_window_8_start_date_8', checkNotEmptyOrUndefined);
  context.start_date_9 = getFieldRecent(ancReports, ANC, 'govt_windows.govt_windows_anc_gov_window_9_start_date_9', checkNotEmptyOrUndefined);
  context.end_date_4 = getFieldRecent(ancReports, ANC, 'govt_windows.govt_windows_anc_gov_window_4_end_date_4', checkNotEmptyOrUndefined);
  context.end_date_6 = getFieldRecent(ancReports, ANC, 'govt_windows.govt_windows_anc_gov_window_6_end_date_6', checkNotEmptyOrUndefined);
  context.end_date_8 = getFieldRecent(ancReports, ANC, 'govt_windows.govt_windows_anc_gov_window_8_end_date_8', checkNotEmptyOrUndefined);
  context.end_date_9 = getFieldRecent(ancReports, ANC, 'govt_windows.govt_windows_anc_gov_window_9_end_date_9', checkNotEmptyOrUndefined);

  // ANC High Risk Variables
  context.hiv_results = getFieldRecent(ancReports, ANC, 'labs.labs_hiv_results', checkNotEmptyOrUndefined);
  context.hcv_results = getFieldRecent(ancReports, ANC, 'labs.labs_hcv_results', checkNotEmptyOrUndefined);
  context.vdrl_results = getFieldRecent(ancReports, ANC, 'labs.labs_vdrl_results', checkNotEmptyOrUndefined);
  context.hb = getFieldRecent(ancReports, ANC, 'labs.labs_hb', checkNotEmptyOrUndefined);
  context.hbsag_results = getFieldRecent(ancReports, ANC, 'labs.labs_hbsag_results', checkNotEmptyOrUndefined);
  context.blood_sugar = getFieldRecent(ancReports, ANC, 'labs.labs_blood_sugar', checkNotEmptyOrUndefined);
  context.blood_grouping = getFieldRecent(ancReports, ANC, 'labs.labs_blood_grouping', checkNotEmptyOrUndefined);
  context.rh_negative = getFieldRecent(ancReports, ANC, 'labs.labs_rh_negative', checkNotEmptyOrUndefined);
  context.urine_protein = getFieldRecent(ancReports, ANC, 'labs.labs_urine_protein', checkNotEmptyOrUndefined);
  context.urine_sugar = getFieldRecent(ancReports, ANC, 'labs.labs_urine_sugar', checkNotEmptyOrUndefined);
  context.urine_ph = getFieldRecent(ancReports, ANC, 'labs.labs_urine_ph', checkNotEmptyOrUndefined);
  context.labs_complete = getFieldRecent(ancReports, ANC, 'labs.labs_labs_complete', checkNotEmptyOrUndefined);

  // Month Completions
  context.fourth_month_complete = getFieldOnce(ancReports, ANC, 'anc_record.anc_record_fourth_month_complete', checkNotEmptyOrUndefined);
  context.sixth_month_complete = getFieldOnce(ancReports, ANC, 'anc_record.anc_record_sixth_month_complete', checkNotEmptyOrUndefined);
  context.eighth_month_complete = getFieldOnce(ancReports, ANC, 'anc_record.anc_record_eighth_month_complete', checkNotEmptyOrUndefined);
  context.ninth_month_complete = getFieldOnce(ancReports, ANC, 'anc_record.anc_record_ninth_month_complete', checkNotEmptyOrUndefined);

  // Previous Deliveries
  context.cs_previous_delivery = getFieldOnce(ancReports, ANC, 'previous_delivery.cs_previous_delivery', checkNotEmptyOrUndefined);

  // Patient History
  context.hypertension_history = getFieldOnce(ancReports, ANC, 'history.history_hypertension_history', checkNotEmptyOrUndefined);
  context.diabetes_history = getFieldOnce(ancReports, ANC, 'history.history_diabetes_history', checkNotEmptyOrUndefined);
  context.chronic_hypertension_history = getFieldOnce(ancReports, ANC, 'hypertension_calculations_chronic_hypertension', checkNotEmptyOrUndefined);

  // Extracting Total Parity
  context.total_parity = getField(getNewestReport(allReports, [PREGNANCY_HISTORY]), 'group_assessment.total_parity');
  context.total_parity_update = getField(getNewestReport(allReports, [POST_DELIVERY]), 'total_parity_update');

  // ANC LMP Date Calculation
  let latestLMPDate = getFieldRecent(ancReports, ANC, 'lmp_group.lmp_group_lmp', checkNotEmptyOrUndefined);
  let latestLMPDateNepali = getFieldRecent(ancReports, ANC, 'lmp_group.lmp_group_lmp_nepali', checkNotEmptyOrUndefined);

  if (latestLMPDate === undefined) {
    latestLMPDate = getFieldRecent(allReports, PREGNANCY_SCREENING, 'continue_pss.continue_pss_lmp_group.continue_pss_lmp_group_lmp_date_calc', checkNotEmptyOrUndefined);
    latestLMPDateNepali = getFieldRecent(allReports, PREGNANCY_SCREENING, 'continue_pss.continue_pss_lmp_group.continue_pss_lmp_group_lmp_date_calc_nepali', checkNotEmptyOrUndefined);
  }

  context.lmp = latestLMPDate;
  context.lmp_nepali = latestLMPDateNepali;
  context.weeks_pregnant = getFieldRecent(ancReports, ANC, 'lmp_group.lmp_group_weeks_pregnant', checkNotEmptyOrUndefined);
  context.months_pregnant = getFieldRecent(ancReports, ANC, 'lmp_group.lmp_group_months_pregnant', checkNotEmptyOrUndefined);
  context.edd = getFieldRecent(ancReports, ANC, 'lmp_group.lmp_group_edd', checkNotEmptyOrUndefined);
  context.edd_nepali = getFieldRecent(ancReports, ANC, 'lmp_group.lmp_group_edd_nepali', checkNotEmptyOrUndefined);

  // USG Variables
  context.usg_date = getFieldRecent(ancReports, ANC, 'usg.usg_usg_date', checkNotEmptyOrUndefined);
  context.usg_date_nepali = getFieldRecent(ancReports, ANC, 'usg.usg_usg_date_nepali', checkNotEmptyOrUndefined);
  context.usg_results = getFieldRecent(ancReports, ANC, 'usg.usg_usg', checkNotEmptyOrUndefined);
  context.placenta_location_condition = getFieldRecent(ancReports, ANC, 'usg.usg_placenta_location_condition', checkNotEmptyOrUndefined);
  context.fetal_presentation_condition = getFieldRecent(ancReports, ANC, 'usg.usg_fetal_presentation_condition', checkNotEmptyOrUndefined);
  context.fetal_presentation_condition_other = getFieldRecent(ancReports, ANC, 'usg.usg_fetal_presentation_condition_other', checkNotEmptyOrUndefined);
  context.no_of_fetus = getFieldRecent(ancReports, ANC, 'usg.usg_no_of_fetus', checkNotEmptyOrUndefined);
  context.fetal_heart_rate = getFieldRecent(ancReports, ANC, 'usg.usg_fetal_heart_rate', checkNotEmptyOrUndefined);
  context.amniotic_fluid = getFieldRecent(ancReports, ANC, 'usg.usg_amniotic_fluid', checkNotEmptyOrUndefined);
  context.bpd_weeks = getFieldRecent(ancReports, ANC, 'usg.usg_measurements.usg_measurements_bpd_weeks', checkNotEmptyOrUndefined);
  context.bpd_days = getFieldRecent(ancReports, ANC, 'usg.usg_measurements.usg_measurements_bpd_days', checkNotEmptyOrUndefined);
  context.bpd_length = getFieldRecent(ancReports, ANC, 'usg.usg_measurements.usg_measurements_bpd_length', checkNotEmptyOrUndefined);
  context.femur_length_weeks = getFieldRecent(ancReports, ANC, 'usg.usg_measurements.usg_measurements_femur_length_weeks', checkNotEmptyOrUndefined);
  context.femur_length_days = getFieldRecent(ancReports, ANC, 'usg.usg_measurements.usg_measurements_femur_length_days', checkNotEmptyOrUndefined);
  context.estimate_fetal_weight = getFieldRecent(ancReports, ANC, 'usg.usg_measurements.usg_measurements_estimate_fetal_weight', checkNotEmptyOrUndefined);
  context.gestational_age_weeks = getFieldRecent(ancReports, ANC, 'usg.usg_ultrasound_gestational_age.usg_ultrasound_gestational_age_weeks  ', checkNotEmptyOrUndefined);
  context.gestational_age_days = getFieldRecent(ancReports, ANC, 'usg.usg_ultrasound_gestational_age.usg_ultrasound_gestational_age_days', checkNotEmptyOrUndefined);
  context.usg_complete = getField(latestANCReport, ANC, 'usg.usg_usg_complete');

  // Immunization Varibales
  context.previous_pregnancy = getField(latestANCReport, 'general.general_previous_pregnancy');
  context.td_first_dose = getFieldOnce(ancReports, 'immun_meds.immun_meds_td_first_dose', checkNotEmptyOrUndefined);
  context.td_second_dose = getFieldOnce(ancReports, 'immun_meds.immun_meds_td_second_dose', checkNotEmptyOrUndefined);
  context.albendazole_taken = getFieldOnce(ancReports, 'immun_meds.immun_meds_albendazole_taken', checkNotEmptyOrUndefined);
  context.daily_iron = getFieldOnce(ancReports, 'immun_meds.immun_meds_daily_iron', checkNotEmptyOrUndefined);

  // Visit Details
  context.last_visit = getFieldRecent(ancReports, ANC, 'next_visit_last_visit', checkNotEmptyOrUndefined);
  context.next_visit_due_anc = getFieldRecent(ancReports, ANC, 'next_visit_next_visit_due_anc', checkNotEmptyOrUndefined);

  getCurrentANCVisits(ancReports, context);
}

function getContext(thisContact, allReports) {
  let context = {};

  if (thisContact.contact_type === 'c82_person') {
    const hasBecomeRecord = allReports.some(report => [ANC, POST_DELIVERY, 'epds_screening'].includes(report.form));
    if (hasBecomeRecord) {
      const latestBecomeSessionForm = getNewestReport(allReports, ANC);
      const latestBecomeForm = getNewestReport(allReports, POST_DELIVERY);
      const updatedDeliveryDate = getField(latestBecomeForm, 'post_delivery_assessment.delivery_date_pdf');
      const latestlmp = getField(latestBecomeSessionForm, 'lmp_group.lmp_group_lmp');
      const delivery_date = getField(latestBecomeForm, 'delivery_date_pdf_ctx');
      const latestEPDS_report = getNewestReport(allReports, 'epds_screening');
      const epdsEligibility = getField(latestEPDS_report, 'epds.postnatal_d_screen.fln_elig');
      const currentStatusWomen = getField(latestEPDS_report, 'epds.screening.curr_sts');
      const totalForms = (reports, formName) => {
        const latestScreening = getNewestReport(reports, ['epds_screening']);

        if (!latestScreening) {
          return null;
        }

        const moduleForms = reports.filter(report => report.form === formName);

        if (moduleForms.length === 0) {
          return 1;
        }

        return Math.min(moduleForms.length + 1, Number.MAX_SAFE_INTEGER);
      };
      const totalFormsM_1 = totalForms(allReports, 'epds_module_1');
      const totalFormsM_2 = totalForms(allReports, 'epds_module_2');
      const totalFormsM_3 = totalForms(allReports, 'epds_module_3');
      const totalFormsM_4 = totalForms(allReports, 'epds_module_4');
      const totalFormsM_5 = totalForms(allReports, 'epds_module_5');

      context.totalforms1 = totalFormsM_1;
      context.totalforms2 = totalFormsM_2;
      context.totalforms3 = totalFormsM_3;
      context.totalforms4 = totalFormsM_4;
      context.totalforms5 = totalFormsM_5;

      const formatDate = convertToISO(delivery_date);
      context.eligibility = epdsEligibility;
      context.women_status_ctx = currentStatusWomen;

      context.formated_date = formatDate;
      context.delivery_date = formatDate;
      context.updated_dd = updatedDeliveryDate;
      context.latestlmp = latestlmp;


    }
  }
  if (thisContact.contact_type === 'c82_person') {
    const hasPsuppRecord = allReports.some(report => [PSUPP].includes(report.form));
    if (hasPsuppRecord) {
      const latestPsuppScreeningForm = getNewestReport(allReports, PSUPP);
      // const latestPsuppHomeVisit = getNewestReport(allReports, PSUPP_HOME_VISIT);
      // const latestPsuppWeeklyVisit = getNewestReport(allReports, PSUPP_WEEKLY_VISIT);
      const formCapMap = {
        'psupp_home_visit': 5,
        'psupp_weekly_visit': 4,
        'psupp_form': 1   
      };
      const totalForms = (reports, formName) => {
        if (!latestPsuppScreeningForm) {
          return null;
        }
        const count = reports.filter(report => report.form === formName && report.reported_date > latestPsuppScreeningForm.reported_date).length;
        const cap = formCapMap[formName] || 5;


        return 'visit_' + Math.min(count + 1, cap);
      };


      const totalHomeVist = totalForms(allReports, PSUPP_HOME_VISIT);
      const totalWeeklyVisit = totalForms(allReports, PSUPP_WEEKLY_VISIT);
      const totalBiweeklyVisit = totalForms(allReports, PSUPP_BI_WEEKLY_VISIT);

      context.home_visit = totalHomeVist;
      context.weekly_visit = totalWeeklyVisit;
      context.biweekly_visit = totalBiweeklyVisit;

      console.log('this the context varible data', context.home_visit, context.weekly_visit);
    }
  }

  if (thisContact.contact_type !== 'c82_person') {

    if (thisContact.contact_type !== 'c52_ward_contact') {
      return context;
    }

    // Calculating stock related case variables
    const stockInFields = [
      'initial_stock.initial_stock_zinc10mg',
      'initial_stock.initial_stock_zinc20mg',
      'initial_stock.initial_stock_ors',
      'initial_stock.initial_stock_condoms_hp',
      'initial_stock.initial_stock_condoms_phc',
      'initial_stock.initial_stock_total_condoms',
      'initial_stock.initial_stock_UPT_kits'
    ];
    const latestStockOut = getNewestReport(allReports, [STOCK_OUT]);
    const latestStockOutDate = latestStockOut ? latestStockOut.reported_date : 0;

    let latestStockIn = getAggregatedReport(
      getReportsBetween(allReports, [STOCK_IN], latestStockOutDate),
      stockInFields
    );
    const newestStockIn = getNewestReport(allReports, [STOCK_IN]);

    if (!latestStockIn) {
      latestStockIn = getAggregatedReport(
        [newestStockIn],
        stockInFields
      );

      if (!latestStockIn) {
        return {};
      }
    }

    context = {
      'initial_zinc10mg': latestStockIn['initial_stock.initial_stock_zinc10mg'],
      'initial_zinc20mg': latestStockIn['initial_stock.initial_stock_zinc20mg'],
      'initial_ors': latestStockIn['initial_stock.initial_stock_ors'],
      'initial_condoms_hp': latestStockIn['initial_stock.initial_stock_condoms_hp'],
      'initial_condoms_phc': latestStockIn['initial_stock.initial_stock_condoms_phc'],
      'initial_total_condoms': latestStockIn['initial_stock.initial_stock_total_condoms'],
      'initial_upt_kits': latestStockIn['initial_stock.initial_stock_UPT_kits']
    };

    if (latestStockOut) {
      if (latestStockOut.reported_date > latestStockIn.reported_date) {
        context = Object.assign(context, mapContent(latestStockOut, STOCK_OUT));
        return context;
      }

      // Adding last month remaining stock to the new initial stock
      context.available_zinc_10mg = latestStockIn['initial_stock.initial_stock_zinc10mg'] + getIntegerField(latestStockOut, 'remaining_zinc_10mg');
      context.available_zinc_20mg = latestStockIn['initial_stock.initial_stock_zinc20mg'] + getIntegerField(latestStockOut, 'remaining_zinc_20mg');
      context.available_ors = latestStockIn['initial_stock.initial_stock_ors'] + getIntegerField(latestStockOut, 'remaining_ors');
      context.available_condom = latestStockIn['initial_stock.initial_stock_total_condoms'] + getIntegerField(latestStockOut, 'remaining_condom');
      context.available_upt_kit = latestStockIn['initial_stock.initial_stock_UPT_kits'] + getIntegerField(latestStockOut, 'remaining_upt_kit');
    } else {
      context.available_zinc_10mg = latestStockIn['initial_stock.initial_stock_zinc10mg'];
      context.available_zinc_20mg = latestStockIn['initial_stock.initial_stock_zinc20mg'];
      context.available_ors = latestStockIn['initial_stock.initial_stock_ors'];
      context.available_condom = latestStockIn['initial_stock.initial_stock_total_condoms'];
      context.available_upt_kit = latestStockIn['initial_stock.initial_stock_UPT_kits'];
    }

    return context;
  }

  // Disabling muting
  context.muted = false;

  // Checking if contact is active for early skip
  const isContactActive = isActive(allReports);
  context.active = isContactActive;

  if (!isContactActive) { return context; }

  const age = getAgeFromDOB(thisContact.dob);
  context.current_age = age;

  const eligibleU2 = age < 2;

  context.eligible_u2 = eligibleU2;

  if (eligibleU2) {
    // Fetching U2 context and exiting
    getU2Context(thisContact, allReports, context);
    return context;
  }

  if (thisContact.sex !== 'female' && (age < 11 || age > 48) && thisContact.marital_status !== 'married') { return context; }

  // Sunmmary, if Pregnancy History is initialized
  context.has_initialized_ph = isInitilizationComplete(thisContact, allReports, PREGNANCY_HISTORY, (report) => {
    const { woman_at_home, woman_consent } = report.fields;
    return woman_at_home === 'yes' && woman_consent === '1';
  });

  // Summary, if PSS is initialized or expired
  // context.has_initialized_pss = isInitilizationComplete(thisContact, allReports, PREGNANCY_SCREENING, (report) => getField('remove_woman') === '1' || Math.floor((new Date().getTime() - report.reported_date) / (1000 * 60 * 60 * 24)) < 105);

  // Adding pregnancy history and pss delivery variables, if form not complete
  let latestPSS = getNewestReport(allReports, [PREGNANCY_SCREENING]);
  if (latestPSS) {
    getPSSContext(allReports, context);

    // Fetching PDF context
    const latestPDF = getNewestReport(allReports, [POST_DELIVERY]);
    let deliveryDate = getField(latestPDF, 'post_delivery_assessment.delivery_date_pdf');
    if (!latestPDF || (latestPDF && !deliveryDate)) {
      const mostRecentDeliveryReport = getNewestReport(allReports, [PREGNANCY_SCREENING], latestPDF ? latestPDF.reported_date : null, (report) => getField(report, 'pdf_direct') !== '1');

      if (mostRecentDeliveryReport) {
        deliveryDate = getField(mostRecentDeliveryReport, 'standard.standard_delivery_date_pdf');
      }
    }

    if (!deliveryDate) {
      const latestANC = getMostRecentUnskippedReport(allReports, ANC);

      if (latestANC && latestANC.reported_date > latestPSS.reported_date) {
        deliveryDate = getField(latestANC, 'lmp_group.lmp_group_edd');
      }
    }

    if (deliveryDate) {
      deliveryDate = formatDate(new Date(deliveryDate));
    }

    // Checking PSS, ANC and PDF before PNC to preserve order of program
    if (getField(latestPSS, 'woman_at_home') === 'yes' && getField(latestPSS, 'agrees_for_service') === 'yes') {
      context.lmp_days_calc = getField(latestPSS, 'continue_pss.continue_pss_lmp_group.continue_pss_lmp_group_lmp_days_calc');
      context.contraceptive_current = getField(latestPSS, 'continue_pss.continue_pss_contraceptive_related.continue_pss_contraceptive_related_contraceptive_current');

      // Checking for anc and anc escape condition
      const ancActive = isANCActive(allReports);
      context.anc_active = ancActive;
      if (ancActive) {
        // Fetching ANC context and exiting
        getANCContext(allReports, context);
        return context;
      }

      // Checking for pdf and pdf context 
      if (!latestPDF || latestPSS.reported_date > latestPDF.reported_date) {
        if (getField(latestPSS, 'pdf_direct') === '1') {
          getPDFContext(allReports, context, false);
        } else if (getField(latestPSS, 'anc') === '1' && !ancActive) {
          getPDFContext(allReports, context, true);
        }
      }
    }

    if (deliveryDate) {
      const ppDays = Math.floor((new Date() - new Date(deliveryDate)) / (1000 * 60 * 60 * 24));
      const pnc1 = (ppDays < 365 && getField(latestPDF, 'status_pnc1') === '1') ? '1' : '0';
      const pnc2 = (ppDays < 60 && getField(latestPDF, 'status_pnc2') === '1') ? '1' : '0';

      // Setting values to context
      context.delivery_date_pdf = deliveryDate;
      context.pp_days = ppDays;
      context.pnc1 = pnc1;
      context.pnc2 = pnc2;

      // Getting contraceptive current from PNC if availale
      if (pnc1 === '1') {
        const latestPNC = getMostRecentUnskippedReport(allReports, PNC);

        if (latestPNC && latestPNC.reported_date > latestPSS.reported_date) {
          context.contraceptive_current = getField(latestPNC, 'group_assessment_contraceptive.year_after_delivery_contraceptive_current');
        }
      }

      if (pnc2 === '1') {
        const latestPNC2 = getMostRecentUnskippedReport(allReports, PNC2);

        if (latestPNC2 && latestPNC2.reported_date > latestPSS.reported_date) {
          context.contraceptive_current = getField(latestPNC2, 'pnc_assessment.group_assessment_currentcontraceptive.contraceptive_current');
        }
      }

      if (ppDays < 60 && latestPDF) {
        // Check for PNC Contexts
        if (pnc1 === '1') {
          getPNC1Context(allReports, context);
        } else if (pnc2 === '1') {
          getPNC2Context(allReports, context);
        }
      }
    }
  }
  // Adding delivery date and LMP date to context Fir the perinatal worflow
  return context;
}
// this will covernt the raw date foramte to year-month-day format
function convertToISO(dateString) {
  const date = new Date(dateString); // Create a Date object from the string
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`; // Format as 'YYYY-MM-DD'
}

const daysSinceDelivery1 = (reports) => {
  const deliveryDate = getField(getNewestReport(reports, 'psupp_form'), 'psupp');
  const deliveryDate1 = getField(getNewestReport(reports, 'psupp_form'), 'epds.psupp');
  const deliveryDate2 = reports;

  return { deliveryDate, deliveryDate1, deliveryDate2 };
};
console.log('reportdata', daysSinceDelivery1(reports));


module.exports = {
  today,
  getNewestReport,
  getAgeFromDOB,
  isAlive,
  isActive,
  getPersonLifeStatus,
  getFormArraySubmittedInWindow,
  getField,
  allPlaces,
  allPersons,
  getContext,
  nonHouseholdPlaces,
  nonHouseholdPersons,
  isInitilizationComplete,
  isFormClosed
};
