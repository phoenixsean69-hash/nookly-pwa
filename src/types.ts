export type TenantType = 'student' | 'family' | 'single';
export type UserMode = 'tenant' | 'landlord' | 'student' | 'driver';

export interface NooklyUser {
  $id: string;
  accountId: string;
  email: string;
  name: string;
  userMode: UserMode;
  tenantType?: TenantType;
  schoolLocation?: string;
  phone?: string;
  avatar?: string;
}

export interface Property {
  $id: string;
  $createdAt?: string;
  propertyName?: string;
  type?: string;
  description?: string;
  address?: string;
  price?: number;
  new_price?: number;
  currency?: string;
  image1?: string;
  image2?: string;
  image3?: string;
  images?: string[];
  facilities?: string | string[] | Record<string, unknown>;
  bedrooms?: number;
  bathrooms?: number;
  roomFor?: number;
  area?: number;
  totalSlots?: number;
  availableSlots?: number;
  isAvailable?: boolean;
  rating?: number;
  reviews?: string;
  likes?: number;
  views?: number;
  requests?: number;
  creatorId?: string;
  creatorName?: string;
  creatorPhone?: string;
  creatorEmail?: string;
  isUniversityApproved?: boolean;
  organizationApproved?: string | boolean;
  [key: string]: unknown;
}

export const RESIDENTIAL_TYPES = ['All', 'Boarding', 'House', 'Apartment', 'Cottage', 'Duplex', 'Studio', 'Luxury'];
