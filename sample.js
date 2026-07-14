// sample.js — embedded fallback products (SAMPLE badge state)
// Lets the app render with zero network, per basin.
//   Atlantic: TWD/TWO/TCM (the Jul 7 2026 discussion + Lee advisory demo).
//   East Pacific: TWDEP/TWOEP captured live from api.weather.gov (recent-real
//   product pattern; the AXPZ20/ABPZ20 + TWDEP/TWOEP AWIPS lines are kept so
//   detectBasin and the sample gates resolve the basin). EP ships no TCM sample.
window.TWD_SAMPLE = `TWDAT
Tropical Weather Discussion
NWS National Hurricane Center Miami FL
805 AM EDT Mon Jul 7 2026

Tropical Weather Discussion for North America, Central America
Gulf of America, Caribbean Sea, northern sections of South
America, and Atlantic Ocean to the African coast from the
Equator to 32N.

...TROPICAL WAVES...

A tropical wave has its axis along 22W from 05N to 17N, moving
west at 10 to 15 kt. Scattered moderate convection is noted from
07N to 12N between 14W and 28W.

A second tropical wave has its axis along 46W south of 17N,
moving west at 15 kt. Scattered moderate to isolated strong
convection is from 03N to 07N between 40W and 50W.

A third tropical wave is along 54W south of 16N, moving west at
15 kt. Scattered moderate convection is from 05N to 08N between
50W and 58W.

...ITCZ/MONSOON TROUGH...

The monsoon trough extends from 08N27W to 08N44W to 09N57W.
Scattered moderate convection is noted within 120 nm of the
trough axis.

...DISCUSSION...

A surface trough is analyzed near 27N85W over the eastern Gulf of
America. A weak upper-level low is centered near 24N60W. A 1015
mb high is centered near 31N40W, supporting fresh trade winds
south of its axis. A disturbed area between Hispaniola and the
southeastern Bahamas bears watching over the next several days.

\$\$
`;
window.TWO_SAMPLE = `Tropical Weather Outlook
NWS National Hurricane Center Miami FL
800 AM EDT Mon Jul 7 2026

For the North Atlantic...Caribbean Sea and the Gulf of America:

A tropical wave near the Lesser Antilles is producing disorganized
showers. Environmental conditions could support slow development
later this week while it moves west-northwest at 10 to 15 mph.
* Formation chance through 48 hours...low...20 percent.
* Formation chance through 7 days...medium...40 percent.

Tropical cyclone formation is not expected during the next 48 hours
elsewhere across the basin.

$$`;
window.TCM_SAMPLE = `HURRICANE LEE FORECAST/ADVISORY NUMBER  23
NWS NATIONAL HURRICANE CENTER MIAMI FL       AL132023
0300 UTC MON SEP 11 2023

HURRICANE CENTER LOCATED NEAR 22.6N  62.2W AT 11/0300Z

PRESENT MOVEMENT TOWARD THE NORTHWEST OR 305 DEGREES AT   7 KT

ESTIMATED MINIMUM CENTRAL PRESSURE  950 MB
MAX SUSTAINED WINDS 105 KT WITH GUSTS TO 130 KT.
64 KT....... 65NE  40SE  40SW  55NW.
50 KT.......110NE  80SE  60SW  90NW.
34 KT.......150NE 140SE 100SW 140NW.

FORECAST VALID 11/1200Z 23.1N  63.1W
MAX WIND 115 KT...GUSTS 140 KT.

FORECAST VALID 12/0000Z 23.6N  64.4W
MAX WIND 120 KT...GUSTS 145 KT.

FORECAST VALID 13/0000Z 24.6N  66.4W
MAX WIND 110 KT...GUSTS 135 KT.

FORECAST VALID 14/0000Z 26.5N  67.7W
MAX WIND  95 KT...GUSTS 115 KT.

OUTLOOK VALID 15/0000Z 30.2N  67.9W
MAX WIND  85 KT...GUSTS 105 KT.

OUTLOOK VALID 16/0000Z 35.5N  67.0W
MAX WIND  70 KT...GUSTS  85 KT.

$$`;

window.TWDEP_SAMPLE = `AXPZ20 KNHC 140801
TWDEP 

Tropical Weather Discussion
NWS National Hurricane Center Miami FL
1005 UTC Tue Jul 14 2026

Tropical Weather Discussion for the eastern Pacific Ocean from
03.4S to 30N, east of 120W including the Gulf of California, and
from the Equator to 30N, between 120W and 140W. The following
information is based on satellite imagery, weather observations,
radar, and meteorological analysis.

Based on 0600 UTC surface analysis and satellite imagery through
0700 UTC.

...SPECIAL FEATURES...

Offshore of Southwestern Mexico (EP96): A tropical wave is
producing a large area of disorganized thunderstorms and gusty 
winds a couple of hundred nautical miles south of the coast of 
southwestern Mexico. Numerous moderate isolated strong convection
is noted from 13N to 16N between 101W and 108W. Winds are 
currently 20 to 30 kt with seas of 8 to 12 ft. This system is 
gradually becoming better organized, and environmental conditions
appear favorable for continued development. A tropical 
depression is expected to form during the next day or so while 
the system moves generally west- northwestward, staying offshore 
of the coast of Mexico. Expect strong winds and rough seas near 
the Revillagigedo Islands by Tue night, as the low pressure makes
its closest point of approach to the south of the islands. The 
latest Tropical Weather Outlook gives this system a high chance 
of tropical cyclone formation in the next 48 hours. Please read 
the latest Tropical Weather Outlook issued by the National 
Hurricane Center at www.hurricanes.gov for further details. 

...TROPICAL WAVES...

The axis of a tropical wave is near 88.5W, north of 01N to 
across portions of El Salvador and western Honduras into the
Yucatan Peninsula, moving quickly westward at 20 to 25 kt.
Scattered moderate isolated strong convection is noted from
11N to 13.5N between 87W and 93W.

The axis of a tropical wave is near 104.5W, from 03N northward 
to the coast of SW Mexico in Colima, moving westward at around 
10 to 15 kt. Any nearby convection is described in the Special 
Features section regarding the potential for tropical cyclone 
formation.

The axis of a tropical wave is along 134.5W from 04N to 20N, 
moving slowly westward at around 5 kt. A weak low pressure area
that was previously analyzed along the tropical wave has
dissipated within that last few hours. Any nearby convection is 
described below in the ITCZ/monsoon trough section.
 
...INTERTROPICAL CONVERGENCE ZONE/MONSOON TROUGH...

The monsoon trough extends from 11N74W to 09N88W. Segments of 
the ITCZ are from 07.5N89W to 10N103.5W, then from 10N105W to
05N122W to 13N133W, then from 13.5N135W to 10N140W. Scattered 
moderate isolated strong convection is active within 240 nm 
south of the ITCZ west of 105W. A surface trough is analyzed from
17N127W to 10N126.5W. Scattered moderate isolated strong 
convection is noted from 17N to 25N between 123W and 129W, and 
from 11N to 17N between 129W and 133W.

...OFFSHORE WATERS WITHIN 250 NM OF MEXICO...

In addition to the winds and seas described in the Special
Features section off southwest Mexico, fresh to strong gap winds
are across the Gulf of Tehuantepec as seen by a recent OSCAT
scatterometer pass. Broad ridging is evident elsewhere, including 
off Baja California, supporting gentle to moderate breezes and 
3-5 ft seas elsewhere, except light breezes and 1-3 ft seas in 
the Gulf of California. 

For the forecast, in addition to the impacts of the developing 
low pressure described in the Special Features section above, the
ridge will continue to dominate the offshore forecast waters of 
Baja California through early Thu, allowing for gentle to 
moderate NW to N winds to continue along with moderate seas in 
mixed swell. In the Gulf of California, mainly gentle winds will 
prevail through tonight, increasing to moderate to locally fresh
in the central and northern portions midweek. Fresh to strong 
northerly winds will pulse in the Gulf of Tehuantepec during the 
week and into the upcoming weekend, strongest during the late 
night and early morning hours, with locally rough seas at times.

Looking ahead, an area of low pressure is expected to form later
this week several hundred nautical miles south of the coast of 
southern Mexico. Environmental conditions appear conducive for 
gradual development of this system thereafter, and a tropical 
depression could form by the end of the weekend while it moves 
generally west-northwestward well offshore of Mexico.

....OFFSHORE WATERS WITHIN 250 NM OF CENTRAL AMERICA, COLOMBIA,
AND WITHIN 750 NM OF ECUADOR...

Fresh to strong E winds across the Gulf of Papagayo as seen by a
recent ASCAT scatterometer pass, with moderate to fresh easterly
winds elsewhere from 10N to 13N. Winds are moderate or weaker
across the remainder of the waters. Moderate seas dominate the 
waters. Active convection over the offshore waters of El Salvador
and Guatemala are associated with a tropical wave and are 
described above, with locally higher winds and seas.

For the forecast, fresh to strong gap winds will prevail in the 
Papagayo region mainly at night through at least Sat night along
with moderate to locally rough seas. Moderate or weaker winds 
and moderate seas in SW swell will prevail elsewhere, except in 
the lee of the Galapagos Islands where slight seas are expected. 

...REMAINDER OF THE AREA...

Moderate to fresh NE winds are near the northern portion of a
tropical wave at 134.5W along with locally rough seas. Gentle to
moderate winds 4-6 ft prevail elsewhere, except for moderate to
fresh SE winds and 5-7 ft seas south of 07N between 100W and 
120W. A surface trough is analyzed north of the ITCZ as described
with convection above.

For the forecast, winds and seas associated with the tropical
wave near 134.5W diminish through today. NE winds will freshen 
with seas 5-7 ft thereafter north of 15N and west of 125W between
broad low pressure along the monsoon trough riding farther 
north. Elsewhere, the main issue will be the development and 
track of the low pressure described in the Special Features 
section above. Expect tropical cyclone development with this low 
pressure through mid week as it moves northwest of the 
Revillagigedo Islands. Farther south, moderate to fresh SE winds 
and 5-7 ft seas will cross the Equator between 100W and 120W and 
reach as far north as 10N through mid week. Looking ahead, an area
of low pressure is expected to form later this week several 
hundred nautical miles south of the coast of southern Mexico. 
Environmental conditions appear conducive for gradual development
of this system thereafter, and a tropical depression could form 
by the end of the weekend while it moves generally west- 
northwestward well offshore of Mexico.

$$
Lewitsky
`;
window.TWOEP_SAMPLE = `ABPZ20 KNHC 141151
TWOEP 

Tropical Weather Outlook
NWS National Hurricane Center Miami FL
500 AM PDT Tue Jul 14 2026

For the eastern and central North Pacific east of 180 longitude:

Offshore of Southwestern Mexico (EP96):
Showers and thunderstorms have become better organized and are 
producing gusty winds in association with a tropical wave located a 
few hundred miles south-southwest of the coast of southwestern 
Mexico.  Environmental conditions are favorable for continued 
development.  A tropical depression or tropical storm is expected 
to form later today or tonight while the system moves generally 
west-northwestward, staying well offshore of the coast of Mexico. 
For additional information, including gale warnings, please see 
High Seas Forecasts issued by the National Weather Service.
* Formation chance through 48 hours...high...90 percent. 
* Formation chance through 7 days...high...near 100 percent.

Well South of the Hawaiian Islands (CP91):
Shower and thunderstorm activity has decreased in association with a 
broad area of low pressure located several hundred miles south of 
the Hawaiian Islands.  Earlier satellite wind data showed that the  
system lacks a well-defined surface circulation.  A tropical 
depression could still form over the next day or two while the 
system moves little.  The disturbance is expected to move into less 
favorable environmental conditions later this week, likely ending 
its chances of development.
* Formation chance through 48 hours...medium...60 percent. 
* Formation chance through 7 days...medium...60 percent.

Well Southwest of the Hawaiian Islands (CP90):
A trough of low pressure located several hundred miles to the 
southwest of the Hawaiian Islands continues to produce an area of 
disorganized showers and thunderstorms.  Environmental conditions 
appear favorable for gradual development, and the system could 
become a tropical depression later in the week while it moves 
slowly northwestward, remaining well southwest of the Hawaiian 
Islands. 
* Formation chance through 48 hours...low...30 percent. 
* Formation chance through 7 days...medium...50 percent.

Offshore of Southern and Southwestern Mexico:
An area of low pressure is expected to form later this week several 
hundred miles south of the coast of southern Mexico.  Environmental 
conditions appear conducive for gradual development of this system 
thereafter, and a tropical depression is likely to form by the end 
of the weekend while it moves generally west-northwestward well 
offshore of Mexico.
* Formation chance through 48 hours...low...near 0 percent.
* Formation chance through 7 days...high...70 percent.

&&

High Seas Forecasts issued by the National Weather Service can be 
found under AWIPS header NFDHSFEP1, WMO header FZPN02 KWBC, and on 
the web at ocean.weather.gov/shtml/NFDHSFEP1.php

$$
Forecaster Hagen/Katz
`;
