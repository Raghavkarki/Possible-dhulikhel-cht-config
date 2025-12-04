const { addDays, getField, getMostRecentReport, isActive, getDeliveryDate, mapContent,
  getPPDays, getMostRecentUnskippedReport, isFormArraySubmittedInWindow, isContactUnder2, getNewestReport, totalPsuppSessions, isAtLeastXWeeksSinceLMP, monthsdeliverydate, getpdfContent, totalForms, compareANCAndPostDeliveryDates, validateANCisLatestAndNoEPDS } = require('./nools-extras');

const { PREGNANCY_SCREENING, POST_DELIVERY, U2_REGISTRY, ANC, PNC, PNC2, INFINITY, PSUPP, PSUPP_HOME_VISIT, PSUPP_WEEKLY_VISIT } = require('./constants');

const intervals = {
  u2: {
    start: 7,
    end: INFINITY,
    followups: 30,
  },
  pnc: {
    start: 7,
    end: 7,
    followups: ['0:d', '3:d', '7:d', '28:d', '2:m']
  },
  anc: {
    start: 7,
    end: 7,
    followups: ['0:d', '1:m', '2:m', '3:m', '4:m', '5:m', '6:m', '7:m', '8:m', '9:m'],
  },
  pss: {
    start: 14,
    end: INFINITY,
    followups: 90,
  },
  pdf: {
    start: 0,
    end: 7,
    followups: 0
  }
};

const parseIntervals = (interval) => {
  let [quant, unit] = interval.split(':');

  // Parsing number portion of the interval
  quant = Number.parseInt(quant);

  return unit === 'm' ? quant * 30 : quant;
};

const gapCalculator = ({ woman_at_home, reason_absence, child_at_home }, normal) => {
  if (woman_at_home === 'no' || child_at_home === 'no') {
    // Short gap for immediate followup
    if (['gone_for_work', 'back_6_month', 'location_unknown'].includes(reason_absence)) {
      return 30;
    }

    if (reason_absence === 'back_in_1_year') {
      return 90;
    }
  }

  return normal;
};

const taskApplier = (extraConditions = null) => {
  return (contact, report) => {
    if (!isActive(contact)) {
      return false;
    }

    const mostRecentReport = getMostRecentReport(contact.reports, report.form);

    if (mostRecentReport && mostRecentReport.reported_date > report.reported_date) {
      return false;
    } else {
      return !(extraConditions && !extraConditions(contact, report));
    }
  };
};

const taskResolver = (extraConditions, targetForm = undefined) => {
  return (contact, report, event, dueDate) => {
    let start = Math.max(addDays(dueDate, - event.start).getTime(), report.reported_date);
    let end = addDays(dueDate, event.end).getTime();

    targetForm = (targetForm !== undefined) ? targetForm : report.form;
    if (targetForm === PREGNANCY_SCREENING) {
      start = report.reported_date + 1;
    }

    return !isActive(contact) || isFormArraySubmittedInWindow(contact.reports, [targetForm], start, end) || (extraConditions && extraConditions(contact, report, event, dueDate));
  };
};

const eventGenerators = {
  pss: (interval, { start, end }) => ({
    id: 'pregnancy-screening-followup',
    start,
    end,
    dueDate: (event, contact, report) => {
      if (report && report.form) {
        if (report.form === PREGNANCY_SCREENING) {
          const urine_test_result = getField(report, 'continue_pss.continue_pss_test.continue_pss_test_urine_test');

          if (urine_test_result && ['indetermined', 'test_malfunctioning', 'not_tested'].includes(urine_test_result)) {
            return addDays(report.reported_date, 15);
          }
        } else if (report.form === POST_DELIVERY) {
          const pncAdjustedGap = getField(report, 'pnc2') === '1' ? 60 : interval;
          return addDays(report.reported_date, pncAdjustedGap);
        }
      }

      return addDays(report.reported_date, gapCalculator(report.fields, interval));
    },
  }),
  u2: (interval, { start, end }) => ({
    id: 'u2-followup',
    start,
    end,
    dueDate: (event, contact, report) => addDays(report.reported_date, gapCalculator(report.fields, interval)),
  }),
  anc: (interval, { start, end }) => ({
    id: `anc-visit-${Math.round(interval / 30) + 1}`,
    start,
    end,
    dueDate: (event, contact, report) => addDays(report.reported_date, interval),
  }),
  pnc: (interval, { start, end }) => ({
    id: `pnc-visit-${interval}-days`,
    start: (interval <= 7) ? 1 : start,
    end: (interval < 7) ? 1 : end,
    dueDate: (event, contact, report) => addDays(getDeliveryDate(contact.reports, report), interval),
  }),
  pdf: (interval, { start, end }) => ({
    id: 'post-delivery',
    start,
    end,
    dueDate: (event, contact, report) => addDays(report.reported_date, interval),
  }),
};

const epds_assessmentSchedule = [
  { start: 150, due: 90, end: 15 },
  { start: 15, due: 180, end: 15 },
  { start: 15, due: 270, end: 15 }
].map((event, idx) => {
  return {
    id: `epds_event_${idx + 1}`,
    start: event.start,
    days: event.due,   // rename due → days
    end: event.end
  };
});



module.exports = [
  {
    name: 'u2-registry',
    icon: 'icon-pregnancy',
    title: 'task.u2_first.title',
    appliesTo: 'contacts',
    appliesToType: ['c82_person'],
    appliesIf: (contact) => {
      return isContactUnder2(contact) && getNewestReport(contact.reports, U2_REGISTRY) === undefined;
    },
    actions: [
      {
        type: 'report',
        form: U2_REGISTRY
      }
    ],
    events: [
      {
        id: 'u2-registration',
        start: 0,
        days: 0,
        end: 30
      }
    ],
    resolvedIf: (contact, report, event, dueDate) => {
      return !isActive(contact);
    }
  },
  {
    name: 'pss-followup',
    icon: 'icon-pregnancy',
    title: 'task.pss.title',
    appliesTo: 'reports',
    appliesToType: [PREGNANCY_SCREENING, POST_DELIVERY],
    appliesIf: taskApplier((contact, report) => {
      if (report.form === PREGNANCY_SCREENING) {
        // Filtering contacts with ages over 49
        if (contact && contact.contact && contact.contact.dob && Math.floor(Math.abs(new Date() - new Date(contact.contact.dob)) / (1000 * 60 * 60 * 24 * 365)) > 49) {
          return false;
        }

        return getField(report, 'anc') !== '1' && getField(report, 'pdf_direct') !== '1' && getField(report, 'remove_woman') !== '1';
      }

      return true;
    }),
    actions: [
      {
        type: 'report',
        form: PREGNANCY_SCREENING
      }
    ],
    events: [eventGenerators.pss(intervals.pss.followups, intervals.pss)],
    resolvedIf: taskResolver(null, PREGNANCY_SCREENING),
  },
  {
    name: 'u2-registry-followup',
    icon: 'icon-pregnancy',
    title: 'task.u2.title',
    appliesTo: 'reports',
    appliesToType: [U2_REGISTRY],
    appliesIf: taskApplier((contact, report) => isContactUnder2(contact)),
    actions: [
      {
        type: 'report',
        form: U2_REGISTRY
      }
    ],
    events: [eventGenerators.u2(intervals.u2.followups, intervals.u2)],
    resolvedIf: taskResolver(),
  },
  {
    name: 'anc_visit',
    icon: 'icon-pregnancy',
    title: 'task.anc.title',
    appliesTo: 'reports',
    appliesToType: [PREGNANCY_SCREENING],
    actions: [{ form: ANC }],
    appliesIf: (contact, report) => {
      return getField(report, 'anc') === '1';
    },
    events: intervals.anc.followups.map(parseIntervals).map(interval => eventGenerators.anc(interval, intervals.anc)),
    resolvedIf: taskResolver((contact, report, event, dueDate) => {
      const mostRecentANC = getMostRecentReport(contact.reports, [ANC]);

      if (mostRecentANC && mostRecentANC.reported_date && mostRecentANC.reported_date > report.reported_date) {
        return getField(mostRecentANC, 'eligible_woman') === '1' || getField(mostRecentANC, 'post_delivery') === '1' || getField(mostRecentANC, 'anc') === '0';
      }

      return false;
    }, ANC),
  },
  {
    name: 'post_delivery',
    icon: 'icon-pregnancy',
    title: 'task.pdf.title',
    appliesTo: 'reports',
    appliesToType: [ANC, PREGNANCY_SCREENING],
    actions: [{ form: POST_DELIVERY }],
    appliesIf: taskApplier((contact, report) => {
      const pdfField = (report.form === PREGNANCY_SCREENING) ? 'pdf_direct' : 'post_delivery';
      return getField(report, pdfField) === '1';
    }),
    events: [eventGenerators.pdf(intervals.pdf.followups, intervals.pdf)],
    resolvedIf: taskResolver(null, POST_DELIVERY),
  },
  {
    name: 'pss_false_pregnancy',
    icon: 'icon-pregnancy',
    title: 'task.pss.title',
    appliesTo: 'reports',
    appliesToType: [ANC],
    actions: [
      {
        type: 'report',
        form: PREGNANCY_SCREENING,
        modifyContent: (content, contact, report) => {
          content = Object.assign(content, mapContent(getMostRecentUnskippedReport(contact.reports, PREGNANCY_SCREENING)), mapContent(getNewestReport(contact.reports, POST_DELIVERY), PREGNANCY_SCREENING));
        }
      }
    ],
    appliesIf: taskApplier((contact, report) => {
      return getField(report, 'eligible_woman') === '1';
    }),
    events: [eventGenerators.pss(0, intervals.pss)],
    resolvedIf: taskResolver(null, PREGNANCY_SCREENING),
  },
  {
    name: 'pnc_visit',
    icon: 'icon-pregnancy',
    title: 'task.pnc.title',
    appliesTo: 'reports',
    appliesToType: [POST_DELIVERY],
    actions: [
      {
        type: 'report',
        form: PNC,
        modifyContent: (content, contact, report) => {
          contact = Object.assign(content, mapContent(report, PNC));
        }
      }
    ],
    appliesIf: taskApplier((contact, report) => {
      return getField(report, 'status_pnc1') === '1' && getPPDays(report) < 60;
    }),
    events: intervals.pnc.followups.map(parseIntervals).map(interval => eventGenerators.pnc(interval, intervals.pnc)),
    resolvedIf: taskResolver(null, PNC)
  },
  {
    name: 'pnc2_visit',
    icon: 'icon-pregnancy',
    title: 'task.pnc2.title',
    appliesTo: 'reports',
    appliesToType: [POST_DELIVERY],
    actions: [
      {
        type: 'report',
        form: PNC2,
        modifyContent: (content, contact, report) => {
          contact = Object.assign(content, mapContent(report, PNC));
        }
      }
    ],
    appliesIf: taskApplier((contact, report) => {
      return getField(report, 'status_pnc2') === '1' && getPPDays(report) < 60;
    }),
    events: intervals.pnc.followups.map(parseIntervals).map(interval => eventGenerators.pnc(interval, intervals.pnc)),
    resolvedIf: taskResolver(null, PNC2),
  },
  {
    name: 'perinatal_screening',
    icon: 'icon-perinatal-screening',
    title: 'task.perinatal_screening',
    appliesTo: 'reports',
    appliesToType: [POST_DELIVERY],
    appliesIf: taskApplier((contact, report) => {
      const outcome = getpdfContent(contact);
      console.log('outcome', outcome);

      return outcome === 1 && monthsdeliverydate(contact, 10);
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_screening',
      }
    ],
    events: [
      {
        start: 7,
        days: 7,
        end: 90000
      },
    ]
  },
  {
    name: 'perinatal_screening_1',
    icon: 'icon-perinatal-screening',
    title: 'task.perinatal_screening_1',
    appliesTo: 'reports',
    appliesToType: [ANC],
    appliesIf: taskApplier((contact, report) => {
      const outcome = validateANCisLatestAndNoEPDS(contact);
      return outcome === 1 && isAtLeastXWeeksSinceLMP(contact, 14);
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_screening',
      }
    ],
    events: [
      {
        start: 7,
        days: 7,
        end: 90000
      },
    ]
  },
  // {
  //   name: 'perinatal_screening_2',
  //   icon: 'icon-perinatal-screening',
  //   title: 'task.perinatal_screening_2',
  //   appliesTo: 'reports',
  //   appliesToType: ['epds_screening'],
  //   appliesIf: taskApplier((contact, report) => {
  //     const task = comparePDFAndEPDSDates(contact);
  //     const task2 = recurringS(contact);
  //     console.log('tasks2', task2, contact);
  //     console.log('tasks2ascas', task);

  //     const finalEligi = getField(report, 'epds.postnatal_d_screen.fln_elig');
  //     return (
  //           finalEligi === '2' && task2 === 'active'
  //           // && task === 'active' 
  //     );


  //   }),

  //   actions: [
  //     {
  //       type: 'report',
  //       form: 'epds_screening',
  //     }
  //   ],
  //   events: [
  //     {
  //       start: 7,
  //       days: 30,
  //       end: 90000
  //     },
  //   ]
  // },

  {
    name: 'perinatal_module_1',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_1',
    appliesTo: 'reports',
    appliesToType: ['epds_screening'],
    appliesIf: taskApplier((contact, report) => {
      const lmpdate = getField(report, 'lmpdays');
      const eligibility = getField(report, 'epds.postnatal_d_screen.fln_elig');
      const women_status = getField(report, 'epds.screening.curr_sts');
      const woman_consent = getField(report, 'epds.study_cnst.cnst_part');
      const totalforms = totalForms(contact, 'epds_module_1');
      const childstatus = getField(report, 'epds.condit_bn');
      const outcome = compareANCAndPostDeliveryDates(contact);

      return (
        ((childstatus === 'none' || childstatus === '') && lmpdate >= 14 && eligibility === '1' && women_status === 'preg_women' && woman_consent === 'yes' && totalforms === 1 && outcome === 1)
      );
    }),
    actions: [
      {
        type: 'report',
        form: 'epds_module_1',
      }
    ],
    events: [
      {
        start: 7,
        days: 7,
        end: 90
      },
    ],
  },
  {
    name: 'perinatal_module_1.1',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_1.1',
    appliesTo: 'reports',
    appliesToType: ['epds_module_1'],
    appliesIf: taskApplier((contact, report) => {
      const childstatus = getField(report, 'module1.cond_m_s');
      const totalforms = totalForms(contact, 'epds_module_1');
      const allowedForms = [2, 3, 4, 5];
      const outcome = compareANCAndPostDeliveryDates(contact);

      return (
        (allowedForms.includes(totalforms) && outcome === 1 && (childstatus === 'none_abve' || childstatus === ''))
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_1',
      }
    ],
    events: [
      {
        start: 2,
        days: 7,
        end: 90
      },
    ],
  },
  {
    name: 'perinatal_module_2',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_2',
    appliesTo: 'reports',
    appliesToType: ['epds_screening'],
    appliesIf: taskApplier((contact, report) => {
      const deliveryd = getField(report, 'ddno');
      const updated_dd = getField(report, 'up_dd');
      const deliveryDateStr = (!updated_dd || updated_dd === 'NaN') ? deliveryd : updated_dd;
      const eligibility = getField(report, 'epds.postnatal_d_screen.fln_elig');
      const women_status = getField(report, 'epds.screening.curr_sts');
      const woman_consent = getField(report, 'epds.study_cnst.cnst_part');
      const totalforms = totalForms(contact, 'epds_module_2');
      const childstatus = getField(report, 'epds.condit_bn');

      return (

        (deliveryDateStr >= 7 && deliveryDateStr < 34 && eligibility === '1' && women_status === 'pp_women' && woman_consent === 'yes' && totalforms === 1 && (childstatus === 'none' || childstatus === ''))
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_2',
      }
    ],
    events: [
      {
        start: 7,
        days: 7,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_2.1',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_2.1',
    appliesTo: 'reports',
    appliesToType: ['epds_module_2'],
    appliesIf: taskApplier((contact, report) => {
      const childstatus = getField(report, 'module2.cond_m2_s');
      const totalforms = totalForms(contact, 'epds_module_2');
      const allowedForms = [2, 5];
      return (

        (allowedForms.includes(totalforms) && (childstatus === 'no_ab' || childstatus === ''))
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_2',
      }
    ],
    events: [
      {
        start: 2,
        days: 7,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_2.2',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_2.2',
    appliesTo: 'reports',
    appliesToType: ['epds_module_2'],
    appliesIf: taskApplier((contact, report) => {
      const totalforms = totalForms(contact, 'epds_module_2');
      const childstatus = getField(report, 'module2.cond_m2_s');


      const allowedForms = [3, 4];
      return (

        (allowedForms.includes(totalforms) && childstatus === 'no_ab')
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_2',
      }
    ],
    events: [
      {
        start: 2,
        days: 15,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_3',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_3',
    appliesTo: 'reports',
    appliesToType: ['epds_screening'],
    appliesIf: taskApplier((contact, report) => {
      const deliveryd = getField(report, 'ddno');
      const updated_dd = getField(report, 'up_dd');
      const childstatus = getField(report, 'epds.condit_bn');
      const deliveryDateStr = (!updated_dd || updated_dd === 'NaN') ? deliveryd : updated_dd;
      const eligibility = getField(report, 'epds.postnatal_d_screen.fln_elig');
      const women_status = getField(report, 'epds.screening.curr_sts');
      const woman_consent = getField(report, 'epds.study_cnst.cnst_part');
      const totalforms = totalForms(contact, 'epds_module_3');
      // const allowedForms = [2, 3, 4, 5];
      return (

        (deliveryDateStr >= 35 && deliveryDateStr < 120 && eligibility === '1' && women_status === 'pp_women' && woman_consent === 'yes' && totalforms === 1 && (childstatus === 'none' || childstatus === ''))
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_3',
      }
    ],
    events: [
      {
        start: 7,
        days: 7,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_3.1',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_3.1',
    appliesTo: 'reports',
    appliesToType: ['epds_module_3'],
    appliesIf: taskApplier((contact, report) => {
      const totalforms = totalForms(contact, 'epds_module_3');
      const childstatus = getField(report, 'module3.cond_m3_s');
      const allowedForms = [2, 5];
      return (
        (allowedForms.includes(totalforms) && (childstatus === 'no_ab' || childstatus === ''))
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_3',
      }
    ],
    events: [
      {
        start: 2,
        days: 7,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_3.2',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_3.2',
    appliesTo: 'reports',
    appliesToType: ['epds_module_3'],
    appliesIf: taskApplier((contact, report) => {
      const childstatus = getField(report, 'module3.cond_m3_s');
      const totalforms = totalForms(contact, 'epds_module_3');
      const allowedForms = [3, 4];
      return (
        (allowedForms.includes(totalforms) && childstatus === 'no_ab')
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_3',
      }
    ],
    events: [
      {
        start: 22,
        days: 30,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_4',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_4',
    appliesTo: 'reports',
    appliesToType: ['epds_screening'],
    appliesIf: taskApplier((contact, report) => {
      const deliveryd = getField(report, 'ddno');
      const updated_dd = getField(report, 'up_dd');
      const childstatus = getField(report, 'epds.condit_bn');
      const deliveryDateStr = (!updated_dd || updated_dd === 'NaN') ? deliveryd : updated_dd;
      const eligibility = getField(report, 'epds.postnatal_d_screen.fln_elig');
      const women_status = getField(report, 'epds.screening.curr_sts');
      const woman_consent = getField(report, 'epds.study_cnst.cnst_part');
      const totalforms = totalForms(contact, 'epds_module_4');
      return (

        (deliveryDateStr >= 121 && deliveryDateStr < 210 && eligibility === '1' && women_status === 'pp_women' && woman_consent === 'yes' && totalforms === 1 && (childstatus === 'none' || childstatus === ''))
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_4',
      }
    ],
    events: [
      {
        start: 7,
        days: 7,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_4.1',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_4.1',
    appliesTo: 'reports',
    appliesToType: ['epds_module_4'],
    appliesIf: taskApplier((contact, report) => {
      const totalforms = totalForms(contact, 'epds_module_4');
      const childstatus = getField(report, 'module4.cond_m4_s');

      // const allowedForms = [2, 3, 4, 5];
      const allowedForms = [2, 5];
      return (

        (allowedForms.includes(totalforms) && (childstatus === 'no_ab' || childstatus === ''))
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_4',
      }
    ],
    events: [
      {
        start: 2,
        days: 7,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_4.2',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_4.2',
    appliesTo: 'reports',
    appliesToType: ['epds_module_4'],
    appliesIf: taskApplier((contact, report) => {
      const totalforms = totalForms(contact, 'epds_module_4');
      const childstatus = getField(report, 'module4.cond_m4_s');
      // const allowedForms = [2, 3, 4, 5];
      const allowedForms = [3, 4];
      return (

        (allowedForms.includes(totalforms) && childstatus === 'no_ab')
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_4',
      }
    ],
    events: [
      {
        start: 22,
        days: 30,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_5',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_5',
    appliesTo: 'reports',
    appliesToType: ['epds_screening'],
    appliesIf: taskApplier((contact, report) => {
      const deliveryd = getField(report, 'ddno');
      const updated_dd = getField(report, 'up_dd');
      const childstatus = getField(report, 'epds.condit_bn');
      const deliveryDateStr = (!updated_dd || updated_dd === 'NaN') ? deliveryd : updated_dd;
      const eligibility = getField(report, 'epds.postnatal_d_screen.fln_elig');
      const women_status = getField(report, 'epds.screening.curr_sts');
      const woman_consent = getField(report, 'epds.study_cnst.cnst_part');
      const totalforms = totalForms(contact, 'epds_module_5');
      return (

        (deliveryDateStr >= 211 && deliveryDateStr < 299 && eligibility === '1' && women_status === 'pp_women' && woman_consent === 'yes' && totalforms === 1 && (childstatus === 'none' || childstatus === ''))
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_5',
      }
    ],
    events: [
      {
        start: 7,
        days: 7,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_5.1',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_5.1',
    appliesTo: 'reports',
    appliesToType: ['epds_module_5'],
    appliesIf: taskApplier((contact, report) => {
      const totalforms = totalForms(contact, 'epds_module_5');
      const childstatus = getField(report, 'module5.cond_m5_s');
      // const allowedForms = [2, 3, 4, 5];
      const allowedForms = [2, 5];
      return (

        (allowedForms.includes(totalforms) && (childstatus === 'no_ab' || childstatus === ''))
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_5',
      }
    ],
    events: [
      {
        start: 2,
        days: 7,
        end: 90
      },
    ]
  },
  {
    name: 'perinatal_module_5.2',
    icon: 'icon-perinatal-module',
    title: 'task.perinatal_module_5.2',
    appliesTo: 'reports',
    appliesToType: ['epds_module_5'],
    appliesIf: taskApplier((contact, report) => {
      const totalforms = totalForms(contact, 'epds_module_5');
      const childstatus = getField(report, 'module5.cond_m5_s');
      // const allowedForms = [2, 3, 4, 5];
      const allowedForms = [3, 4];
      return (

        (allowedForms.includes(totalforms) && childstatus === 'no_ab')
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_module_5',
      }
    ],
    events: [
      {
        start: 22,
        days: 30,
        end: 90
      },
    ]
  },
  {
    name: 'epds_assessment',
    icon: 'icon-perinatal-module',
    title: 'task.epds_assessment',
    appliesTo: 'reports',
    appliesToType: ['epds_screening'],
    appliesIf: taskApplier((contact, report) => {
      const eligibility = getField(report, 'epds.postnatal_d_screen.fln_elig');
      const woman_consent = getField(report, 'epds.study_cnst.cnst_part');
      return (

        (eligibility === '1' && woman_consent === 'yes')
      );
    }),

    actions: [
      {
        type: 'report',
        form: 'epds_assessment',
      }
    ],
    events: epds_assessmentSchedule
  },
  {
    name: 'psuup_home_visit',
    icon: 'icon-perinatal-module1',
    title: 'task.psuup_home_visit',
    appliesTo: 'reports',
    appliesToType: [PSUPP, PSUPP_WEEKLY_VISIT],
    appliesIf: taskApplier((contact, report) => {
      const consent = getField(report, 'psupp_form.cont_call');
      // const consent1 = getField(report, 'psupp_form.cont_call');
      // const consent2 = getField(report, 'psupp_form.cont_call');
      // const getReport = getNewestReport(report, 'psupp_form');

      const totalform = totalPsuppSessions(contact, PSUPP_WEEKLY_VISIT);
      const totalform1 = totalPsuppSessions(contact, PSUPP_HOME_VISIT);
      // const allowedForms = ['visit_4'];
      console.log('logs for the home visssit ', totalform, totalform1);
      return (

        ((consent === 'yes') || (totalform === 'visit_4'))
      );
    }),

    actions: [
      {
        type: 'report',
        form: PSUPP_HOME_VISIT,
      }
    ],
    events: [
      {
        start: 30,
        days: 30,
        end: 90
      },
    ]
  },
  {
    name: 'psuup_weekly_visit',
    icon: 'icon-perinatal-module1',
    title: 'task.psuup_weekly_visit',
    appliesTo: 'reports',
    appliesToType: [PSUPP_HOME_VISIT, PSUPP_WEEKLY_VISIT],
    appliesIf: taskApplier((contact, report) => {
      // const consent = getField(report, 'first_home_visit.end_1stvisit');
      // const consent1 = getField(report, 'visit.weekly_visit');

      // // const getReport = getNewestReport(report, 'psupp_form');

      // const  totalform = totalPsuppSessions(contact, PSUPP_WEEKLY_VISIT);
      // const allowedForms = ['visit_2', 'visit_3'];
      // console.log('logs for the weekly visits', contact, totalform, report, consent);
      // return (
      //   ( consent1 === 'visit_2' || consent1 === 'visit_3'  || consent === 'yes')
      // );
      const formName = report.form;

      if (formName === PSUPP_HOME_VISIT) {
        const consent = getField(report, 'first_home_visit.end_1stvisit');
        return consent === 'yes';
      }

      if (formName === PSUPP_WEEKLY_VISIT) {
        const weekly = getField(report, 'weekly_visit');
        return weekly === 'visit_1' || weekly === 'visit_2';
      }
    }),

    actions: [
      {
        type: 'report',
        form: PSUPP_WEEKLY_VISIT,
      }
    ],
    events: [
      {
        start: 30,
        days: 30,
        end: 90
      },
    ]
  },
];
