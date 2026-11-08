# Flows and state coverage

| Flow                               | Loading                            | Empty                         | Failure                                         | Stale/demo                                                        | Signed out                                                     |
| ---------------------------------- | ---------------------------------- | ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Browse / drops / products / detail | Skeleton, one polite loading label | No matches; clear filters     | Safe API message and retry; 404 distinct        | DEMO DATA, source evidence, freshness and timestamps              | Full public browse; Watch explains sign-in                     |
| Watch product / listing            | Disable submitting button          | Explain each watch scope      | Preserve input and show server error            | Label demo context; don't imply real alert eligibility            | Sign-in then return to original product; no local pretend save |
| Alert wizard / inbox               | Skeleton; submit pending           | No rules / no notifications   | Inline field errors plus summary; inbox retry   | Unavailable source warning                                        | Private content withheld; public browse remains available      |
| ZIP / store list / reports         | Search pending                     | No permitted stores in radius | ZIP/radius errors; map unavailable uses list    | Each seed store/report marked demo; expired excluded              | Browse allowed; submit explains sign-in                        |
| Submit / moderate sighting         | Request pending                    | Review queue empty            | Keep draft; 429 retry guidance                  | Pending receipt; approved is community evidence; expired excluded | Submit denied; staff screen also requires trusted staff        |
| Calendar                           | Skeleton                           | No sourced dates              | Retry                                           | Date precision, source and last verified; no invented dates       | Browse allowed; follow requires session                        |
| Set catalog                        | Skeleton                           | No approved metadata          | Rights-disabled explanation                     | Unknown variant scope is incomplete                               | Browse permitted metadata                                      |
| Open / reveal / resume             | Request pending before reveal      | No enabled sets               | Same idempotency key on retry; history recovery | Fictional rates/version; all coins free; rights gates             | Catalog allowed; opening requires session                      |
| Real / virtual binder              | Paginated skeleton                 | No owned cards; explain modes | Preserve real-edit draft                        | Explicit demo sample if shown; versioned manifests                | No personal records shown                                      |
| Settings / privacy                 | Loading current values             | No pending requests           | Safe server errors                              | Export/delete says queued only after acknowledged                 | Sign-in explanation                                            |

## Keyboard and mobile interaction

- Tab follows DOM reading order: skip, navigation, page heading/actions, filters, results, pagination. Use ordinary links and buttons, never clickable divs.
- Filters use native controls by default. Searchable listbox component uses combobox semantics, Arrow Up/Down, Home/End, Enter, Escape; Tab leaves normally. Expanded content does not trap focus.
- Tabs follow WAI-ARIA manual activation: arrows/Home/End move focus; Enter/Space activates. Panels expose headings; virtual and real mode remain visible in their labels.
- Modal uses native dialog `showModal`, labelled title, explicit Cancel, Escape and focus restoration. Destructive confirmation focuses Cancel. Submit errors focus the summary; field descriptions reference their error IDs.
- Touch controls have at least 44px height; inputs remain at least 16px. Filters wrap; binder is three columns at 360px with an alternate compact list and nine items per page.
- Reveal all provides an immediate server-result list. Reduced motion bypasses decorative transitions. Resume reads the saved opening; no draw occurs on animation or reload.
- Toasts announce status without moving focus. Persistent failures stay in the form rather than disappearing in a toast.

## Privacy and permission

ZIP is manually entered; no geolocation permission or movement tracking. Push is requested only from an explicit Enable notifications action after a support explanation; denial leaves inbox usable. An iOS Home Screen requirement must be explained where relevant by A's actual support detection. Neither a route visit nor a notification preview requests permission.
