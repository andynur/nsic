// NetSuite account URLs. Account ID '1234567_SB1' → host '1234567-sb1'.
export const accountHost = (accountId: string) => accountId.trim().toLowerCase().replace(/_/g, "-");
export const restBase = (accountId: string) => `https://${accountHost(accountId)}.suitetalk.api.netsuite.com`;
export const tokenUrl = (accountId: string) => `${restBase(accountId)}/services/rest/auth/oauth2/v1/token`;
export const authorizeUrl = (accountId: string) => `https://${accountHost(accountId)}.app.netsuite.com/app/login/oauth2/authorize.nl`;
export const suiteqlUrl = (accountId: string) => `${restBase(accountId)}/services/rest/query/v1/suiteql`;
export const recordUrl = (accountId: string, type: string, id: string) => `${restBase(accountId)}/services/rest/record/v1/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
export const metadataUrl = (accountId: string) => `${restBase(accountId)}/services/rest/record/v1/metadata-catalog`;
