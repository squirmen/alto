# Draft Tree Schema

This is an initial analytical schema. It will change once source profiling is complete.

## `tree`

| Field | Type | Notes |
| --- | --- | --- |
| `tree_id` | string | Stable project ID |
| `source_primary` | string | Source slug for primary record |
| `source_ids` | array | All matched source IDs |
| `geometry_point` | geometry | Trunk or best point location |
| `geometry_crown` | geometry | Crown polygon if available |
| `species_common` | string | Common name |
| `species_latin` | string | Scientific name |
| `species_confidence` | string | Confidence class |
| `height_m` | float | Observed or CHM-derived |
| `height_confidence` | string | Confidence class |
| `crown_area_m2` | float | Crown polygon area |
| `dbh_cm` | float | Observed or allometric estimate |
| `dbh_confidence` | string | Confidence class |
| `age_years` | float | Rarely known; use age class where possible |
| `age_confidence` | string | Confidence class |
| `condition` | string | Source or inferred health condition |
| `owner_class` | string | AT, council, private, other, unknown |
| `land_context` | string | Street, park, private parcel, reserve, etc. |
| `catchment_id` | string | Stormwater/hydrological catchment |
| `as_of_date` | date | Best date for this record |

## `tree_service_value`

| Field | Type | Notes |
| --- | --- | --- |
| `tree_id` | string | Foreign key |
| `service` | string | carbon_storage, carbon_sequestration, avoided_runoff, cooling, air_pollution, maintenance_cost, etc. |
| `physical_quantity` | float | Quantity before monetisation |
| `physical_unit` | string | kg, m3/yr, kWh/yr, etc. |
| `value_nzd` | float | Monetary estimate |
| `value_year` | integer | Price year |
| `method_id` | string | Model/method reference |
| `confidence` | string | Confidence class |
| `lower` | float | Optional uncertainty lower bound |
| `upper` | float | Optional uncertainty upper bound |
| `assumptions` | object | Key valuation assumptions |
