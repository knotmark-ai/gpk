<!-- GPK default Task template, revision 1, domain 0.4. Inline fragment, not a
Task document. Use an unchecked checkbox only for a new accepted todo action;
remove comments and unused optional rows. Preserve existing state when updating. -->
- [ ] {{accepted_action}}
  - Done when: {{completion_condition}}
  - Planned attention: {{single_optional_time}}
  - Materials: {{verified_material_references}}

  > {{useful_description_waiting_condition_or_fixed_commitments}}
  >
  > Result: {{actual_result_and_reusable_references}}
