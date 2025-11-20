// const moment = require('moment');
const { getAgeFromDOB, allPlaces, allPersons, getPersonLifeStatus, getContext } = require('./contact-summary-extras');

//contact, reports, lineage are globally available for contact-summary
const HIDDEN_TYPES_FROM_LINEAGE = ['c10_center', 'c20_province'];
const thisContact = contact;
const thisLineage = lineage.filter((parent) => parent && !HIDDEN_TYPES_FROM_LINEAGE.includes(parent.contact_type));
const allReports = reports;

const context = getContext(thisContact, allReports);

const fields = [
  { appliesToType: 'c82_person', label: 'contact.person', value: thisContact.nepali_full_name, width: 4 },
  { appliesIf: function() { return thisContact.dob !== ''; }, appliesToType: 'c82_person', label: 'contact.age', value: getAgeFromDOB(thisContact.dob) + ' years', width: 4},
  { appliesToType: 'c82_person', label: 'contact.sex', value: thisContact.sex && thisContact.sex.charAt(0).toUpperCase() + thisContact.sex.slice(1), translate: true, width: 4 },
  { appliesToType: 'c82_person', label: 'person.field.phone', value: thisContact.telephone_number, width: 4 },
  { appliesIf: function() { return thisContact.dob !== ''; }, appliesToType: 'c82_person', label: 'contact.dob', value: thisContact.dob, width: 4},
  { appliesToType: 'c82_person', label: 'contact.status', value: getPersonLifeStatus(allReports), width: 4 },
  { appliesToType: 'c81_family', label: 'Family ID', value: thisContact.familyID, translate: true, width: 4 },
  { appliesToType: 'c81_family', label: 'Family Head', value: thisContact.head_of_family && thisContact.head_of_family_hoh_name_text, translate: true, width: 4 },
  { appliesToType: 'c81_family', label: 'Total Members', value: thisContact.ses && thisContact.ses.ses_total_family_members, translate: true, width: 4 },
  { appliesToType: 'c80_household', label: 'person.field.house_number', value: thisContact.hhID, translate: true, width: 4 },
  { appliesToType: 'c80_household', label: 'House Owner', value: thisContact.house_owner_house_name, translate: false, width: 4 },
  { appliesToType: 'c80_household', label: 'Family Units', value: thisContact.family_units, translate: false, width: 4 },
  { appliesToType: 'c50_ward', label: 'Place Code', value: thisContact.place_code, translate: false, width: 4 },
  { appliesToType: 'c40_municipality', label: 'Place Code', value: thisContact.place_code, translate: false, width: 4 },
  { appliesToType: allPersons, label: 'person.field.phone', value: thisContact.phone, width: 4 },
  { appliesToType: allPlaces, label: 'Contact', value: thisContact.contact && thisContact.contact.name, width: 4 },
  { appliesToType: allPlaces, label: 'contact.phone.number', value: thisContact.contact && thisContact.contact.phone, width: 4 },
  { label: 'External ID', value: thisContact.external_id, width: 4 },
  { appliesIf: function () { return thisContact.parent && thisLineage[0]; }, label: 'contact.parent', value: thisLineage, filter: 'lineage' },
  { label: 'contact.notes', value: thisContact.notes, width: 12 }
];

module.exports = {
  context: context,
  fields: fields
};
