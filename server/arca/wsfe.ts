import { createClientAsync } from 'soap';
import { ArcaCredentials } from './types';

const WSFE_WSDL = {
  homologation: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL',
  production: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL',
};

export class ArcaWsfe {
  private creds: ArcaCredentials;

  constructor(creds: ArcaCredentials) {
    this.creds = creds;
  }

  async getUltimoAutorizado(token: string, sign: string, cbteTipo: number) {
    // SOAP call to FECompUltimoAutorizado
    throw new Error('IMPLEMENTATION_REQUIRED: WSFEv1 UltimoAutorizado');
  }

  async solicitarCAE(token: string, sign: string, invoiceData: any) {
    // SOAP call to FECAESolicitar
    throw new Error('IMPLEMENTATION_REQUIRED: WSFEv1 SolicitudCAE');
  }
}
