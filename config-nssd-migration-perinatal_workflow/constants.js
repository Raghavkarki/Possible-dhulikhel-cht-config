// Forms
const ANC = 'anc_monitoring_form';
const CHRONIC_DISEASE = 'chronic_disease';
const DEATH_MIGRATION = 'death_and_migration_form';
const FAMILY_AUDIO = 'family_audio';
const HOUSEHOLD_PLAQUE = 'household_plaque';
const HYPERTENSION_SCREENING_FIRST_VISIT = 'hypertension_screening_first_visit_form';
const HYPERTENSION_SCREENING_FOLLOWUP_VISIT = 'hypertension_screening_followup_visit_form';
const IMAM = 'imamform';
const MENSTRUATION_KNOWLEDGE_ASSESSMENT = 'menstruation_knowledge_assessment';
const MI = 'mi_form';
const MID = 'mid_d_form';
const PNC = 'post_natal_care_form';
const PNC2 = 'pnc_2_months';
const POST_DELIVERY = 'post_delivery_form';
const POST_PARTUM_DEPRESSION = 'post_partum_depression';
const PREGNANCY_HISTORY = 'pregnancy_history_form';
const PREGNANCY_SCREENING = 'pregnancy_screening_form';
const SURGICAL_FOLLOWUP = 'surgical_followup';
const U2_REGISTRY = 'u2_registry';
const PSUPP = 'psupp_form';
const PSUPP_HOME_VISIT = 'psupp_home_visit';
const PSUPP_WEEKLY_VISIT = 'psupp_weekly_visit';

// Stock Reports
const STOCK_IN = 'stock_in';
const STOCK_OUT = 'stock_out';

// Groups
const PREGNANCY_HISTORY_FORMS = [PREGNANCY_SCREENING, POST_DELIVERY, PREGNANCY_HISTORY];
const DELIVERY_TRIGGER_FORMS = [PREGNANCY_SCREENING, ANC];

// Form Groups
const PROCEDURE_DATE_GROUP = 'continue_pss.continue_pss_contraceptive_related.continue_pss_contraceptive_related_procedure_dates.continue_pss_contraceptive_related_procedure_dates';
const MUAC_GROUP = 'group_assessment_agreeinservice.over_2_questions.over_2_questions_malnutrition_screening.over_2_questions_malnutrition_screening_muac_update.over_2_questions_malnutrition_screening_muac_update_muac_update';
const MUAC_GROUP_OLD = 'group_assessment_agreeinservice.over_2_questions.over_2_questions_malnutrition_screening.over_2_questions_malnutrition_screening_muac_update1.over_2_questions_malnutrition_screening_muac_update_muac_update';


// Skip Keys
const AGREES_KEYS = {
    [ANC]: 'visit_type.agrees_for_service',
    [PNC]: 'group_assessment_agrees.agrees_for_service',
    [PNC2]: 'group_assessment_counselagree.agrees_for_service',
    [PREGNANCY_SCREENING]: 'agrees_for_service',
    [U2_REGISTRY]: 'agrees_for_service'
};

const HOME_KEYS = {
    [ANC]: 'visit_type.woman_at_home',
    [PNC]: 'patient_information.group_assessment_athome.woman_at_home',
    [PNC2]: 'group_assessment_athome.woman_at_home',
    [PREGNANCY_SCREENING]: 'woman_at_home',
    [U2_REGISTRY]: 'child_at_home'
};

// Program Infos
const ANC_COUNT = 10;
const INFINITY = 9999999;

module.exports = {
    ANC,
    ANC_COUNT,
    PSUPP,
    PSUPP_HOME_VISIT,
    PSUPP_WEEKLY_VISIT,
    AGREES_KEYS,
    CHRONIC_DISEASE,
    DEATH_MIGRATION,
    FAMILY_AUDIO,
    HOME_KEYS,
    HOUSEHOLD_PLAQUE,
    HYPERTENSION_SCREENING_FIRST_VISIT,
    HYPERTENSION_SCREENING_FOLLOWUP_VISIT,
    IMAM,
    MENSTRUATION_KNOWLEDGE_ASSESSMENT,
    MI,
    MID,
    MUAC_GROUP,
    MUAC_GROUP_OLD,
    PNC,
    PNC2,
    POST_DELIVERY,
    POST_PARTUM_DEPRESSION,
    PREGNANCY_HISTORY,
    PREGNANCY_SCREENING,
    SURGICAL_FOLLOWUP,
    STOCK_IN,
    STOCK_OUT,
    U2_REGISTRY,
    PREGNANCY_HISTORY_FORMS,
    DELIVERY_TRIGGER_FORMS,
    INFINITY,
    PROCEDURE_DATE_GROUP
};
